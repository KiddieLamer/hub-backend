import { Context, Next } from 'hono'
import { AuthUser } from './auth'

export function requirePermission(...requiredPermissions: string[]) {
  return async (c: Context, next: Next) => {
    const user = c.get('user') as AuthUser | undefined
    if (!user) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    const hasPermission = requiredPermissions.some((p) => user.permissions.includes(p))
    if (!hasPermission) {
      return c.json({ error: 'Forbidden' }, 403)
    }

    await next()
  }
}

export function requireRole(...requiredRoles: string[]) {
  return async (c: Context, next: Next) => {
    const user = c.get('user') as AuthUser | undefined
    if (!user) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    const hasRole = requiredRoles.some((r) => user.roles.includes(r))
    if (!hasRole) {
      return c.json({ error: 'Forbidden' }, 403)
    }

    await next()
  }
}

// Module-level access gate for tenant feature routers.
// GET/HEAD/OPTIONS require the read permission, mutations require write.
// Bypass: hub-admin (platform), tenant owner and admin (they run the
// company — "Owner & Admin bisa semua"). Everyone else is checked
// against their tenant-scoped permissions (loaded per X-Tenant-ID
// by tenantMiddleware).
export function requireModuleAccess(readPermission: string, writePermission: string) {
  return async (c: Context, next: Next) => {
    const user = c.get('user') as AuthUser | undefined
    if (!user) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    const tenant = c.get('tenant') as { tenantRole?: string } | undefined
    if (!tenant) {
      return c.json({ error: 'Tenant context required' }, 400)
    }

    if (
      user.platformRole === 'hub-admin' ||
      tenant.tenantRole === 'hub-admin' ||
      tenant.tenantRole === 'owner' ||
      tenant.tenantRole === 'admin'
    ) {
      await next()
      return
    }

    const method = c.req.method
    const need =
      method === 'GET' || method === 'HEAD' || method === 'OPTIONS'
        ? readPermission
        : writePermission

    if (user.permissions?.includes(need)) {
      await next()
      return
    }

    return c.json({ error: 'Forbidden' }, 403)
  }
}
