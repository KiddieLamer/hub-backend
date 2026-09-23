import { Hono } from 'hono'
import { z } from 'zod'
import { eq, and, SQL, ilike } from 'drizzle-orm'
import { db } from '../../../db'
import { clientSubscriptions, clientQuotaBalances } from '../../../db/schema'
import { authMiddleware, type Variables as AuthVariables } from '../../../middleware/auth'
import { requireModuleAccess } from '../../../middleware/rbac'
import { tenantMiddleware, type TenantVariables } from '../../../middleware/tenant'

type Variables = AuthVariables & TenantVariables

const subscriptionsRouter = new Hono<{ Variables: Variables }>()
subscriptionsRouter.use('*', authMiddleware)
subscriptionsRouter.use('*', tenantMiddleware)
subscriptionsRouter.use('*', requireModuleAccess('catalog:read', 'catalog:write'))

const createSubscriptionSchema = z.object({
  subscriptionCode: z.string().min(1).max(100),
  clientId: z.string().uuid(),
  catalogItemId: z.string().uuid(),
  startDate: z.string(),
  endDate: z.string(),
  billingCycle: z.enum(['monthly', 'quarterly', 'annually']).default('monthly'),
  pricePerCycle: z.number().min(0),
  autoRenew: z.boolean().default(true),
  notes: z.string().optional(),
  quotas: z.array(z.object({
    serviceItemId: z.string().uuid(),
    totalQuota: z.number().min(1),
  })).optional(),
})

// List subscriptions
subscriptionsRouter.get('/', async (c) => {
  const tenant = c.get('tenant')
  const { search, status, clientId } = c.req.query()

  const conditions: SQL[] = [eq(clientSubscriptions.tenantId, tenant.tenantId)]

  if (search) conditions.push(ilike(clientSubscriptions.subscriptionCode, `%${search}%`))
  if (status) conditions.push(eq(clientSubscriptions.status, status))
  if (clientId) conditions.push(eq(clientSubscriptions.clientId, clientId))

  const data = await db.query.clientSubscriptions.findMany({
    where: and(...conditions),
    orderBy: (fields, { desc }) => [desc(fields.createdAt)],
  })

  return c.json({ subscriptions: data, total: data.length })
})

// Subscription stats
subscriptionsRouter.get('/stats', async (c) => {
  const tenant = c.get('tenant')

  const all = await db.query.clientSubscriptions.findMany({
    where: eq(clientSubscriptions.tenantId, tenant.tenantId),
    columns: { status: true, billingCycle: true },
  })

  const stats = {
    total: all.length,
    active: all.filter((s) => s.status === 'active').length,
    expired: all.filter((s) => s.status === 'expired').length,
    paused: all.filter((s) => s.status === 'paused').length,
    cancelled: all.filter((s) => s.status === 'cancelled').length,
  }

  return c.json({ stats })
})

// Get subscription detail
subscriptionsRouter.get('/:id', async (c) => {
  const tenant = c.get('tenant')
  const { id } = c.req.param()

  const subscription = await db.query.clientSubscriptions.findFirst({
    where: and(eq(clientSubscriptions.id, id), eq(clientSubscriptions.tenantId, tenant.tenantId)),
  })

  if (!subscription) return c.json({ error: 'Subscription not found' }, 404)

  const quotas = await db.query.clientQuotaBalances.findMany({
    where: eq(clientQuotaBalances.clientSubscriptionId, id),
  })

  return c.json({ subscription: { ...subscription, quotas } })
})

// Create subscription
subscriptionsRouter.post('/', async (c) => {
  const tenant = c.get('tenant')
  const body = createSubscriptionSchema.parse(await c.req.json())

  const [subscription] = await db.insert(clientSubscriptions).values({
    ...body,
    tenantId: tenant.tenantId,
    pricePerCycle: String(body.pricePerCycle),
  }).returning()

  // Create quotas if provided
  if (body.quotas && body.quotas.length > 0) {
    await db.insert(clientQuotaBalances).values(
      body.quotas.map((q) => ({
        clientSubscriptionId: subscription.id,
        serviceItemId: q.serviceItemId,
        totalQuota: q.totalQuota,
        remainingQuota: q.totalQuota,
      }))
    )
  }

  return c.json({ subscription }, 201)
})

// Update subscription
subscriptionsRouter.patch('/:id', async (c) => {
  const tenant = c.get('tenant')
  const { id } = c.req.param()
  const body = createSubscriptionSchema.partial().parse(await c.req.json())

  const [updated] = await db
    .update(clientSubscriptions)
    .set({
      ...body,
      pricePerCycle: body.pricePerCycle ? String(body.pricePerCycle) : undefined,
      updatedAt: new Date(),
    })
    .where(and(eq(clientSubscriptions.id, id), eq(clientSubscriptions.tenantId, tenant.tenantId)))
    .returning()

  if (!updated) return c.json({ error: 'Subscription not found' }, 404)

  return c.json({ subscription: updated })
})

// Pause subscription
subscriptionsRouter.post('/:id/pause', async (c) => {
  const tenant = c.get('tenant')
  const { id } = c.req.param()

  const [updated] = await db
    .update(clientSubscriptions)
    .set({ status: 'paused', updatedAt: new Date() })
    .where(and(eq(clientSubscriptions.id, id), eq(clientSubscriptions.tenantId, tenant.tenantId)))
    .returning()

  if (!updated) return c.json({ error: 'Subscription not found' }, 404)

  return c.json({ subscription: updated })
})

// Resume subscription
subscriptionsRouter.post('/:id/resume', async (c) => {
  const tenant = c.get('tenant')
  const { id } = c.req.param()

  const [updated] = await db
    .update(clientSubscriptions)
    .set({ status: 'active', updatedAt: new Date() })
    .where(and(eq(clientSubscriptions.id, id), eq(clientSubscriptions.tenantId, tenant.tenantId)))
    .returning()

  if (!updated) return c.json({ error: 'Subscription not found' }, 404)

  return c.json({ subscription: updated })
})

// Cancel subscription
subscriptionsRouter.post('/:id/cancel', async (c) => {
  const tenant = c.get('tenant')
  const { id } = c.req.param()

  const [updated] = await db
    .update(clientSubscriptions)
    .set({ status: 'cancelled', autoRenew: false, updatedAt: new Date() })
    .where(and(eq(clientSubscriptions.id, id), eq(clientSubscriptions.tenantId, tenant.tenantId)))
    .returning()

  if (!updated) return c.json({ error: 'Subscription not found' }, 404)

  return c.json({ subscription: updated })
})

// Use quota
subscriptionsRouter.post('/:id/quotas/use', async (c) => {
  const { id } = c.req.param()
  const { serviceItemId } = await c.req.json()

  const quota = await db.query.clientQuotaBalances.findFirst({
    where: and(
      eq(clientQuotaBalances.clientSubscriptionId, id),
      eq(clientQuotaBalances.serviceItemId, serviceItemId),
    ),
  })

  if (!quota) return c.json({ error: 'Quota not found' }, 404)
  if (quota.remainingQuota <= 0) return c.json({ error: 'No remaining quota' }, 400)

  const [updated] = await db
    .update(clientQuotaBalances)
    .set({
      usedQuota: quota.usedQuota + 1,
      remainingQuota: quota.remainingQuota - 1,
      updatedAt: new Date(),
    })
    .where(eq(clientQuotaBalances.id, quota.id))
    .returning()

  return c.json({ quota: updated })
})

// Delete subscription
subscriptionsRouter.delete('/:id', async (c) => {
  const tenant = c.get('tenant')
  const { id } = c.req.param()

  const [deleted] = await db
    .delete(clientSubscriptions)
    .where(and(eq(clientSubscriptions.id, id), eq(clientSubscriptions.tenantId, tenant.tenantId)))
    .returning()

  if (!deleted) return c.json({ error: 'Subscription not found' }, 404)

  return c.json({ message: 'Subscription deleted' })
})

export default subscriptionsRouter
