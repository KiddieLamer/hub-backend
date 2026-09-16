import { Context, Next } from 'hono'
import { jwtVerify } from 'jose'
import { env } from '../config/env'
import { db } from '../db'
import { users, userRoles, roles, rolePermissions, permissions } from '../db/schema'
import { eq, inArray } from 'drizzle-orm'

export interface AuthUser {
  id: string
  email: string
  fullName: string | null
  roles: string[]
  permissions: string[]
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

    const userRolesData = await db
      .select({ roleName: roles.name })
      .from(userRoles)
      .innerJoin(roles, eq(userRoles.roleId, roles.id))
      .where(eq(userRoles.userId, userId))

    const roleNames = userRolesData.map((r) => r.roleName)

    const permissionsData = await db
      .select({ permissionName: permissions.name })
      .from(rolePermissions)
      .innerJoin(roles, eq(rolePermissions.roleId, roles.id))
      .innerJoin(permissions, eq(rolePermissions.permissionId, permissions.id))
      .where(inArray(roles.name, roleNames))

    const permissionNames = [...new Set(permissionsData.map((p) => p.permissionName))]

    c.set('user', {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      roles: roleNames,
      permissions: permissionNames,
    } satisfies AuthUser)

    await next()
  } catch {
    return c.json({ error: 'Invalid token' }, 401)
  }
}
