import { Hono } from 'hono'
import { z } from 'zod'
import { eq, and } from 'drizzle-orm'
import { db } from '../../db'
import { tenants, tenantMembers, users } from '../../db/schema'
import { authMiddleware, type Variables as AuthVariables } from '../../middleware/auth'

type Variables = AuthVariables & {
  tenant: { tenantId: string; tenantRole: string }
}

const tenantsRouter = new Hono<{ Variables: Variables }>()

const createTenantSchema = z.object({
  name: z.string().min(2).max(255),
  slug: z.string().min(2).max(100).regex(/^[a-z0-9-]+$/, 'Slug must be lowercase alphanumeric with hyphens'),
  website: z.string().url().optional(),
  customDomain: z.string().optional(),
  phoneNumber: z.string().max(20).optional(),
  email: z.string().email().optional(),
  address: z.string().optional(),
  taxId: z.string().max(50).optional(),
  logoUrl: z.string().optional(),
  gmapLink: z.string().optional(),
  gdriveLink: z.string().optional(),
})

const updateTenantSchema = z.object({
  name: z.string().min(2).max(255).optional(),
  slug: z.string().min(2).max(100).regex(/^[a-z0-9-]+$/, 'Slug must be lowercase alphanumeric with hyphens').optional(),
  website: z.string().url().optional(),
  customDomain: z.string().optional(),
  phoneNumber: z.string().max(20).optional(),
  email: z.string().email().optional(),
  address: z.string().optional(),
  taxId: z.string().max(50).optional(),
  logoUrl: z.string().optional(),
  gmapLink: z.string().optional(),
  gdriveLink: z.string().optional(),
})

tenantsRouter.use('*', authMiddleware)

tenantsRouter.get('/', async (c) => {
  const user = c.get('user')

  const memberships = await db.query.tenantMembers.findMany({
    where: eq(tenantMembers.userId, user.id),
  })

  const tenantIds = memberships.map((m) => m.tenantId)
  if (tenantIds.length === 0) {
    return c.json({ tenants: [] })
  }

  const allTenants = await db.query.tenants.findMany()

  const result = allTenants
    .filter((t) => tenantIds.includes(t.id))
    .map((t) => {
      const membership = memberships.find((m) => m.tenantId === t.id)
      return {
        id: t.id,
        name: t.name,
        slug: t.slug,
        logoUrl: t.logoUrl,
        plan: t.plan,
        status: t.status,
        role: membership?.role,
      }
    })

  return c.json({ tenants: result })
})

tenantsRouter.post('/', async (c) => {
  const user = c.get('user')
  const body = createTenantSchema.parse(await c.req.json())

  const existing = await db.query.tenants.findFirst({
    where: eq(tenants.slug, body.slug),
  })

  if (existing) {
    return c.json({ error: 'Slug already taken' }, 409)
  }

  const dbSchemaName = `tenant_${body.slug.replace(/-/g, '_')}`

  const [tenant] = await db.insert(tenants).values({
    ...body,
    dbSchema: dbSchemaName,
  }).returning()

  await db.insert(tenantMembers).values({
    userId: user.id,
    tenantId: tenant.id,
    role: 'owner',
  })

  await db.update(users).set({ currentTenantId: tenant.id }).where(eq(users.id, user.id))

  return c.json({ tenant }, 201)
})

tenantsRouter.get('/:id', async (c) => {
  const user = c.get('user')
  const { id } = c.req.param()

  const membership = await db.query.tenantMembers.findFirst({
    where: and(eq(tenantMembers.userId, user.id), eq(tenantMembers.tenantId, id)),
  })

  if (!membership) {
    return c.json({ error: 'Access denied' }, 403)
  }

  const tenant = await db.query.tenants.findFirst({
    where: eq(tenants.id, id),
  })

  if (!tenant) {
    return c.json({ error: 'Tenant not found' }, 404)
  }

  return c.json({ tenant, role: membership.role })
})

tenantsRouter.get('/current', async (c) => {
  const tenantCtx = c.get('tenant')
  const tenant = await db.query.tenants.findFirst({
    where: eq(tenants.id, tenantCtx.tenantId),
  })

  if (!tenant) {
    return c.json({ error: 'Tenant not found' }, 404)
  }

  return c.json({ tenant, role: tenantCtx.tenantRole })
})

tenantsRouter.patch('/current', async (c) => {
  const tenantCtx = c.get('tenant')

  if (!['owner', 'admin'].includes(tenantCtx.tenantRole)) {
    return c.json({ error: 'Insufficient permissions' }, 403)
  }

  const body = updateTenantSchema.parse(await c.req.json())

  const [updated] = await db
    .update(tenants)
    .set({ ...body, updatedAt: new Date() })
    .where(eq(tenants.id, tenantCtx.tenantId))
    .returning()

  return c.json({ tenant: updated })
})

tenantsRouter.post('/switch', async (c) => {
  const { tenantId } = await c.req.json()
  const user = c.get('user')

  const membership = await db.query.tenantMembers.findFirst({
    where: and(
      eq(tenantMembers.userId, user.id),
      eq(tenantMembers.tenantId, tenantId)
    ),
  })

  if (!membership) {
    return c.json({ error: 'Access denied' }, 403)
  }

  await db.update(users).set({ currentTenantId: tenantId }).where(eq(users.id, user.id))

  return c.json({ tenantId, role: membership.role })
})

export default tenantsRouter
