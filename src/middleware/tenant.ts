import { Context, Next } from 'hono'
import { eq, and } from 'drizzle-orm'
import { db } from '../db'
import { tenantMembers, tenants } from '../db/schema'
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

  if (!membership) {
    return c.json({ error: 'Access denied to this tenant' }, 403)
  }

  const tenant = await db.query.tenants.findFirst({
    where: eq(tenants.id, tenantId),
  })

  if (!tenant) {
    return c.json({ error: 'Tenant not found' }, 404)
  }

  c.set('tenant', {
    tenantId: tenant.id,
    tenantRole: membership.role,
  })

  await next()
}
