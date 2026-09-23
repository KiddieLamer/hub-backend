import { Hono } from 'hono'
import { z } from 'zod'
import { eq, and, SQL, ilike } from 'drizzle-orm'
import { db } from '../../../db'
import { purchaseRequests, purchaseRequestItems } from '../../../db/schema'
import { authMiddleware, type Variables as AuthVariables } from '../../../middleware/auth'
import { requireModuleAccessExcept } from '../../../middleware/rbac'
import { requireApprover } from '../../../lib/approvals'
import { tenantMiddleware, type TenantVariables } from '../../../middleware/tenant'

type Variables = AuthVariables & TenantVariables

const purchaseRequestsRouter = new Hono<{ Variables: Variables }>()
purchaseRequestsRouter.use('*', authMiddleware)
purchaseRequestsRouter.use('*', tenantMiddleware)
purchaseRequestsRouter.use('*', requireModuleAccessExcept('procurement:read', 'procurement:write', [{ suffix: '/approve' }]))

const createPRSchema = z.object({
  prNumber: z.string().min(1).max(100),
  department: z.string().min(1).max(100),
  title: z.string().min(1).max(255),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).default('medium'),
  estimatedTotalCost: z.number().min(0).default(0),
  items: z.array(z.object({
    itemName: z.string().min(1).max(255),
    category: z.string().max(100).optional(),
    quantity: z.number().min(1),
    unitOfMeasure: z.string().max(50).default('pcs'),
    estimatedUnitPrice: z.number().min(0).optional(),
    notesSpecification: z.string().optional(),
  })).min(1),
})

const approveSchema = z.object({
  approved: z.boolean(),
  rejectionReason: z.string().optional(),
})

// List PRs
purchaseRequestsRouter.get('/', async (c) => {
  const tenant = c.get('tenant')
  const { search, status, priority } = c.req.query()

  const conditions: SQL[] = [eq(purchaseRequests.tenantId, tenant.tenantId)]

  if (search) conditions.push(ilike(purchaseRequests.title, `%${search}%`))
  if (status) conditions.push(eq(purchaseRequests.status, status))
  if (priority) conditions.push(eq(purchaseRequests.priority, priority))

  const data = await db.query.purchaseRequests.findMany({
    where: and(...conditions),
    orderBy: (fields, { desc }) => [desc(fields.createdAt)],
  })

  return c.json({ purchaseRequests: data, total: data.length })
})

// PR stats
purchaseRequestsRouter.get('/stats', async (c) => {
  const tenant = c.get('tenant')

  const allPRs = await db.query.purchaseRequests.findMany({
    where: eq(purchaseRequests.tenantId, tenant.tenantId),
    columns: { status: true },
  })

  const stats = {
    total: allPRs.length,
    draft: allPRs.filter((p) => p.status === 'draft').length,
    submitted: allPRs.filter((p) => p.status === 'submitted').length,
    approved: allPRs.filter((p) => p.status === 'approved').length,
    rejected: allPRs.filter((p) => p.status === 'rejected').length,
    poCreated: allPRs.filter((p) => p.status === 'po_created').length,
    completed: allPRs.filter((p) => p.status === 'completed').length,
  }

  return c.json({ stats })
})

// Get PR detail
purchaseRequestsRouter.get('/:id', async (c) => {
  const tenant = c.get('tenant')
  const { id } = c.req.param()

  const pr = await db.query.purchaseRequests.findFirst({
    where: and(eq(purchaseRequests.id, id), eq(purchaseRequests.tenantId, tenant.tenantId)),
  })

  if (!pr) return c.json({ error: 'Purchase request not found' }, 404)

  const items = await db.query.purchaseRequestItems.findMany({
    where: eq(purchaseRequestItems.prId, id),
  })

  return c.json({ purchaseRequest: { ...pr, items } })
})

// Create PR
purchaseRequestsRouter.post('/', async (c) => {
  const tenant = c.get('tenant')
  const authUser = c.get('user')
  const body = createPRSchema.parse(await c.req.json())

  const [pr] = await db.insert(purchaseRequests).values({
    ...body,
    tenantId: tenant.tenantId,
    requesterId: authUser.id,
    estimatedTotalCost: String(body.estimatedTotalCost),
  }).returning()

  // Insert items
  if (body.items.length > 0) {
    await db.insert(purchaseRequestItems).values(
      body.items.map((item) => ({
        prId: pr.id,
        itemName: item.itemName,
        category: item.category,
        quantity: item.quantity,
        unitOfMeasure: item.unitOfMeasure,
        estimatedUnitPrice: item.estimatedUnitPrice ? String(item.estimatedUnitPrice) : null,
        notesSpecification: item.notesSpecification,
      }))
    )
  }

  return c.json({ purchaseRequest: pr }, 201)
})

// Update PR
purchaseRequestsRouter.patch('/:id', async (c) => {
  const tenant = c.get('tenant')
  const { id } = c.req.param()
  const body = createPRSchema.partial().parse(await c.req.json())

  const [updated] = await db
    .update(purchaseRequests)
    .set({
      ...body,
      estimatedTotalCost: body.estimatedTotalCost ? String(body.estimatedTotalCost) : undefined,
      updatedAt: new Date(),
    })
    .where(and(eq(purchaseRequests.id, id), eq(purchaseRequests.tenantId, tenant.tenantId)))
    .returning()

  if (!updated) return c.json({ error: 'Purchase request not found' }, 404)

  // Update items if provided
  if (body.items) {
    // Delete old items
    await db.delete(purchaseRequestItems).where(eq(purchaseRequestItems.prId, id))

    // Insert new items
    if (body.items.length > 0) {
      await db.insert(purchaseRequestItems).values(
        body.items.map((item) => ({
          prId: id,
          itemName: item.itemName,
          category: item.category,
          quantity: item.quantity,
          unitOfMeasure: item.unitOfMeasure,
          estimatedUnitPrice: item.estimatedUnitPrice ? String(item.estimatedUnitPrice) : null,
          notesSpecification: item.notesSpecification,
        }))
      )
    }
  }

  return c.json({ purchaseRequest: updated })
})

// Submit draft → submitted (enters RACI approval queue).
purchaseRequestsRouter.post('/:id/submit', async (c) => {
  const tenant = c.get('tenant') as { tenantId: string; tenantRole?: string }
  const authUser = c.get('user') as { id: string; platformRole?: string | null }
  const { id } = c.req.param()

  const existing = await db.query.purchaseRequests.findFirst({
    where: and(eq(purchaseRequests.id, id), eq(purchaseRequests.tenantId, tenant.tenantId)),
    columns: { id: true, status: true, requesterId: true },
  })
  if (!existing) return c.json({ error: 'Purchase request not found' }, 404)
  if (existing.status !== 'draft') return c.json({ error: 'PR is not in draft status' }, 400)

  const canSubmit =
    authUser.platformRole === 'hub-admin' ||
    tenant.tenantRole === 'owner' ||
    tenant.tenantRole === 'admin' ||
    existing.requesterId === authUser.id
  if (!canSubmit) return c.json({ error: 'Hanya pengaju yang dapat mengajukan' }, 403)

  const [updated] = await db
    .update(purchaseRequests)
    .set({ status: 'submitted', updatedAt: new Date() })
    .where(and(eq(purchaseRequests.id, id), eq(purchaseRequests.tenantId, tenant.tenantId)))
    .returning()

  return c.json({ purchaseRequest: updated })
})

// Approve/Reject PR — RACI: parent chain; amount ≥ threshold escalates to owner.
purchaseRequestsRouter.post(
  '/:id/approve',
  requireApprover(async (c) => {
    const tenant = c.get('tenant') as { tenantId: string }
    const { id } = c.req.param()
    const pr = await db.query.purchaseRequests.findFirst({
      where: and(eq(purchaseRequests.id, id), eq(purchaseRequests.tenantId, tenant.tenantId)),
      columns: { requesterId: true, estimatedTotalCost: true },
    })
    return pr ? { requesterUserId: pr.requesterId, amount: pr.estimatedTotalCost } : null
  }),
  async (c) => {
    const tenant = c.get('tenant')
    const authUser = c.get('user')
    const { id } = c.req.param()
    const body = approveSchema.parse(await c.req.json())

    const pr = await db.query.purchaseRequests.findFirst({
      where: and(eq(purchaseRequests.id, id), eq(purchaseRequests.tenantId, tenant.tenantId)),
    })

    if (!pr) return c.json({ error: 'Purchase request not found' }, 404)
    if (pr.status !== 'submitted') return c.json({ error: 'PR is not in submitted status' }, 400)

    const newStatus = body.approved ? 'approved' : 'rejected'
    const [updated] = await db
      .update(purchaseRequests)
      .set({
        status: newStatus,
        approvedBy: body.approved ? authUser.id : null,
        approvalDate: body.approved ? new Date() : null,
        rejectionReason: body.approved ? null : body.rejectionReason,
        updatedAt: new Date(),
      })
      .where(and(eq(purchaseRequests.id, id), eq(purchaseRequests.tenantId, tenant.tenantId)))
      .returning()

    return c.json({ purchaseRequest: updated })
  },
)

// Delete PR (soft delete)
purchaseRequestsRouter.delete('/:id', async (c) => {
  const tenant = c.get('tenant')
  const { id } = c.req.param()

  const [deleted] = await db
    .update(purchaseRequests)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(purchaseRequests.id, id), eq(purchaseRequests.tenantId, tenant.tenantId)))
    .returning()

  if (!deleted) return c.json({ error: 'Purchase request not found' }, 404)

  return c.json({ message: 'Purchase request deleted' })
})

export default purchaseRequestsRouter
