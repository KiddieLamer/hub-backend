import { Context, Next } from 'hono'
import { jwtVerify } from 'jose'
import { env } from '../config/env'
import { db } from '../db'
import { users, userRoles, roles, rolePermissions, permissions } from '../db/schema'
import { eq, and } from 'drizzle-orm'

export interface AuthUser {
  id: string
  email: string
  fullName: string | null
  // Tenant-scoped roles/permissions are filled in by tenantMiddleware
  // (per X-Tenant-ID). Left empty here so we never leak roles/permissions
  // across tenants at the identity layer.
  roles: string[]
  permissions: string[]
  platformRole: string | null
}

export type Variables = {
  user: AuthUser
}

export async function authMiddleware(c: Context<{ Variables: Variables }>, next: Next) {
  const header = c.req.header('Authorization')
  if (!header?.startsWith('Bearer ')) {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  const token = header.slice(7)
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(env.JWT_SECRET))

    const userId = payload.sub
    if (!userId) {
      return c.json({ error: 'Invalid token' }, 401)
    }

    const user = await db.query.users.findFirst({
      where: eq(users.id, userId),
    })

    if (!user) {
      return c.json({ error: 'User not found' }, 401)
    }

    if (user.deletedAt) {
      return c.json({ error: 'Account deleted' }, 401)
    }

    if (user.status === 'suspended') {
      return c.json({ error: 'Account suspended' }, 403)
    }

    // Identity only. Roles/permissions are intentionally empty here:
    // they must be resolved per-tenant by tenantMiddleware, which scopes
    // user_roles by X-Tenant-ID. Loading them globally (as this used to)
    // leaked permissions between tenants that shared a role name.
    c.set('user', {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      roles: [],
      permissions: [],
      platformRole: user.platformRole,
    } satisfies AuthUser)

    await next()
  } catch {
    return c.json({ error: 'Invalid token' }, 401)
  }
}
