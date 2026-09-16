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
