import { Context, Next } from 'hono'
import { eq, and } from 'drizzle-orm'
import { db } from '../db'
import { tenantMembers, tenants, userRoles, roles, rolePermissions, permissions } from '../db/schema'
import { type AuthUser } from './auth'

export interface TenantContext {
  tenantId: string
  tenantRole: string
}

export type TenantVariables = {
  tenant: TenantContext
}

export async function tenantMiddleware(c: Context<{ Variables: { user: AuthUser } & Record<string, unknown> }>, next: Next) {
  const user = c.get('user')
  const tenantId = c.req.header('X-Tenant-ID')

  if (!tenantId) {
    return c.json({ error: 'X-Tenant-ID header required' }, 400)
  }

  const membership = await db.query.tenantMembers.findFirst({
    where: and(
      eq(tenantMembers.userId, user.id),
      eq(tenantMembers.tenantId, tenantId)
    ),
  })

  const isHubAdmin = user.platformRole === 'hub-admin'

  if (!membership && !isHubAdmin) {
    return c.json({ error: 'Access denied to this tenant' }, 403)
  }

  const tenant = await db.query.tenants.findFirst({
    where: eq(tenants.id, tenantId),
  })

  if (!tenant && !isHubAdmin) {
    return c.json({ error: 'Tenant not found' }, 404)
  }

  c.set('tenant', {
    tenantId: tenantId,
    tenantRole: membership?.role || 'hub-admin',
  })

  // Scope RBAC roles/permissions to this tenant. user_roles is per-tenant,
  // so a user with different roles in different companies only carries
  // this tenant's roles here (previously they leaked across tenants).
  const scopedRoles = await db
    .select({ roleName: roles.name })
    .from(userRoles)
    .innerJoin(roles, eq(userRoles.roleId, roles.id))
    .where(and(eq(userRoles.userId, user.id), eq(userRoles.tenantId, tenantId)))

  const scopedPermissions = await db
    .select({ permissionName: permissions.name })
    .from(userRoles)
    .innerJoin(roles, eq(userRoles.roleId, roles.id))
    .innerJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
    .innerJoin(permissions, eq(rolePermissions.permissionId, permissions.id))
    .where(and(eq(userRoles.userId, user.id), eq(userRoles.tenantId, tenantId)))

  c.set('user', {
    ...user,
    roles: scopedRoles.map((r) => r.roleName),
    permissions: [...new Set(scopedPermissions.map((p) => p.permissionName))],
  })

  await next()
}
