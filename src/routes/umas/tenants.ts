import { Hono } from 'hono'
import { z } from 'zod'
import { eq, and, isNull } from 'drizzle-orm'
import { db } from '../../db'
import { tenants, tenantMembers, users } from '../../db/schema'
import { TENANT_CATEGORIES, normalizeCategory, seedTenantTemplate } from '../../lib/tenant-templates'
import { authMiddleware, type Variables as AuthVariables } from '../../middleware/auth'
import { requireHubAdmin } from '../../middleware/platform'

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
  category: z.enum(TENANT_CATEGORIES).optional().default('umum'),
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

  const allTenants = await db.query.tenants.findMany()

  const result = allTenants
    .filter((t) => {
      if (user.platformRole === 'hub-admin') return true
      return memberships.some((m) => m.tenantId === t.id)
    })
    .map((t) => {
      const membership = memberships.find((m) => m.tenantId === t.id)
      return {
        id: t.id,
        name: t.name,
        slug: t.slug,
        logoUrl: t.logoUrl,
        plan: t.plan,
        status: t.status,
        role: membership?.role || (user.platformRole === 'hub-admin' ? 'hub-admin' : null),
      }
    })

  return c.json({ tenants: result })
})

tenantsRouter.get('/all', requireHubAdmin, async (c) => {
  const allTenants = await db.query.tenants.findMany({
    orderBy: (tenants, { desc }) => [desc(tenants.createdAt)],
  })

  return c.json({ tenants: allTenants })
})

tenantsRouter.post('/', requireHubAdmin, async (c) => {
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

  // Seed industry template: roles + positions + default mapping.
  await seedTenantTemplate(tenant.id, body.category)

  return c.json({ tenant }, 201)
})

// Backfill industry template into an existing tenant (hub-admin only).
// Idempotent: existing roles/positions (by name) are skipped, never overwritten.
tenantsRouter.post('/:id/seed-template', requireHubAdmin, async (c) => {
  const { id } = c.req.param()
  const raw = await c.req.json().catch(() => ({}))
  const parsed = z.object({ category: z.enum(TENANT_CATEGORIES).optional() }).parse(raw)

  const tenant = await db.query.tenants.findFirst({
    where: eq(tenants.id, id),
  })
  if (!tenant) {
    return c.json({ error: 'Tenant not found' }, 404)
  }

  const category = parsed.category ?? normalizeCategory((tenant as { category?: string }).category)
  const result = await seedTenantTemplate(id, category)

  return c.json({ tenantId: id, ...result })
})

tenantsRouter.get('/current', async (c) => {
  const authUser = c.get('user')
  const user = await db.query.users.findFirst({
    where: eq(users.id, authUser.id),
    columns: { currentTenantId: true },
  })

  if (!user?.currentTenantId) {
    return c.json({ error: 'No tenant selected' }, 400)
  }

  const tenant = await db.query.tenants.findFirst({
    where: eq(tenants.id, user.currentTenantId),
  })

  if (!tenant) {
    return c.json({ error: 'Tenant not found' }, 404)
  }

  const membership = await db.query.tenantMembers.findFirst({
    where: and(
      eq(tenantMembers.userId, authUser.id),
      eq(tenantMembers.tenantId, tenant.id),
    ),
  })

  return c.json({ tenant, role: membership?.role || 'member' })
})

tenantsRouter.patch('/current', async (c) => {
  const authUser = c.get('user')
  const user = await db.query.users.findFirst({
    where: eq(users.id, authUser.id),
    columns: { currentTenantId: true },
  })

  if (!user?.currentTenantId) {
    return c.json({ error: 'No tenant selected' }, 400)
  }

  const membership = await db.query.tenantMembers.findFirst({
    where: and(
      eq(tenantMembers.userId, authUser.id),
      eq(tenantMembers.tenantId, user.currentTenantId),
    ),
  })

  const isHubAdmin = authUser.platformRole === 'hub-admin'
  const canUpdate = isHubAdmin || (membership && ['owner', 'admin'].includes(membership.role))

  if (!canUpdate) {
    return c.json({ error: 'Insufficient permissions' }, 403)
  }

  const body = updateTenantSchema.parse(await c.req.json())

  const [updated] = await db
    .update(tenants)
    .set({ ...body, updatedAt: new Date() })
    .where(eq(tenants.id, user.currentTenantId))
    .returning()

  return c.json({ tenant: updated })
})

const switchTenantSchema = z.object({
  tenantId: z.string().uuid(),
})
tenantsRouter.post('/switch', async (c) => {
  const user = c.get('user')
  const body = switchTenantSchema.parse(await c.req.json())

  const tenant = await db.query.tenants.findFirst({
    where: and(eq(tenants.id, body.tenantId), isNull(tenants.deletedAt)),
  })
  if (!tenant) {
    return c.json({ error: 'Tenant not found' }, 404)
  }

  const membership = await db.query.tenantMembers.findFirst({
    where: and(
      eq(tenantMembers.userId, user.id),
      eq(tenantMembers.tenantId, body.tenantId),
    ),
  })

  if (!membership && user.platformRole !== 'hub-admin') {
    return c.json({ error: 'Access denied' }, 403)
  }

  await db.update(users)
    .set({ currentTenantId: body.tenantId })
    .where(eq(users.id, user.id))

  return c.json({ tenantId: body.tenantId, role: membership?.role || 'hub-admin' })
})

tenantsRouter.delete('/:id', requireHubAdmin, async (c) => {
  const { id } = c.req.param()

  await db.delete(tenantMembers).where(eq(tenantMembers.tenantId, id))
  await db.delete(tenants).where(eq(tenants.id, id))

  return c.json({ success: true })
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

export default tenantsRouter
