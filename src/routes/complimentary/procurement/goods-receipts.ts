import { Hono } from 'hono'
import { z } from 'zod'
import { eq, and, SQL, inArray } from 'drizzle-orm'
import { db } from '../../../db'
import { goodsReceipts, purchaseOrders } from '../../../db/schema'
import { authMiddleware, type Variables as AuthVariables } from '../../../middleware/auth'
import { requireModuleAccess } from '../../../middleware/rbac'
import { tenantMiddleware, type TenantVariables } from '../../../middleware/tenant'

type Variables = AuthVariables & TenantVariables

const goodsReceiptsRouter = new Hono<{ Variables: Variables }>()
goodsReceiptsRouter.use('*', authMiddleware)
goodsReceiptsRouter.use('*', tenantMiddleware)
goodsReceiptsRouter.use('*', requireModuleAccess('procurement:read', 'procurement:write'))

const createGRSchema = z.object({
  grNumber: z.string().min(1).max(100),
  poId: z.string().uuid(),
  deliveryNoteNumber: z.string().max(100).optional(),
  status: z.enum(['completed', 'damaged_items', 'returned']).default('completed'),
  deliveryPhotoUrl: z.string().url().optional(),
  notes: z.string().optional(),
})

// List GRs
goodsReceiptsRouter.get('/', async (c) => {
  const tenant = c.get('tenant')
  const { status } = c.req.query()

  const tenantPoIds = db.select({ id: purchaseOrders.id }).from(purchaseOrders).where(eq(purchaseOrders.tenantId, tenant.tenantId))
  const conditions: SQL[] = [inArray(goodsReceipts.poId, tenantPoIds)]

  if (status) conditions.push(eq(goodsReceipts.status, status))

  const data = await db.query.goodsReceipts.findMany({
    where: and(...conditions),
    orderBy: (fields, { desc }) => [desc(fields.receivedDate)],
  })

  return c.json({ goodsReceipts: data, total: data.length })
})

// Get GR detail
goodsReceiptsRouter.get('/:id', async (c) => {
  const tenant = c.get('tenant')
  const { id } = c.req.param()

  const tenantPoIds = db.select({ id: purchaseOrders.id }).from(purchaseOrders).where(eq(purchaseOrders.tenantId, tenant.tenantId))

  const gr = await db.query.goodsReceipts.findFirst({
    where: and(eq(goodsReceipts.id, id), inArray(goodsReceipts.poId, tenantPoIds)),
  })

  if (!gr) return c.json({ error: 'Goods receipt not found' }, 404)

  return c.json({ goodsReceipt: gr })
})

// Create GR
goodsReceiptsRouter.post('/', async (c) => {
  const tenant = c.get('tenant')
  const authUser = c.get('user')
  const body = createGRSchema.parse(await c.req.json())

  const validPo = await db.query.purchaseOrders.findFirst({
    where: and(eq(purchaseOrders.id, body.poId), eq(purchaseOrders.tenantId, tenant.tenantId)),
  })
  if (!validPo) return c.json({ error: 'Purchase order not found' }, 404)

  const [gr] = await db.insert(goodsReceipts).values({
    ...body,
    tenantId: tenant.tenantId,
    receivedBy: authUser.id,
  }).returning()

  return c.json({ goodsReceipt: gr }, 201)
})

// Update GR
goodsReceiptsRouter.patch('/:id', async (c) => {
  const tenant = c.get('tenant')
  const { id } = c.req.param()
  const body = createGRSchema.partial().parse(await c.req.json())

  const tenantPoIds = db.select({ id: purchaseOrders.id }).from(purchaseOrders).where(eq(purchaseOrders.tenantId, tenant.tenantId))

  const [updated] = await db
    .update(goodsReceipts)
    .set({ ...body, updatedAt: new Date() })
    .where(and(eq(goodsReceipts.id, id), inArray(goodsReceipts.poId, tenantPoIds)))
    .returning()

  if (!updated) return c.json({ error: 'Goods receipt not found' }, 404)

  return c.json({ goodsReceipt: updated })
})

// Delete GR
goodsReceiptsRouter.delete('/:id', async (c) => {
  const tenant = c.get('tenant')
  const { id } = c.req.param()

  const tenantPoIds = db.select({ id: purchaseOrders.id }).from(purchaseOrders).where(eq(purchaseOrders.tenantId, tenant.tenantId))

  const [deleted] = await db
    .delete(goodsReceipts)
    .where(and(eq(goodsReceipts.id, id), inArray(goodsReceipts.poId, tenantPoIds)))
    .returning()

  if (!deleted) return c.json({ error: 'Goods receipt not found' }, 404)

  return c.json({ message: 'Goods receipt deleted' })
})

export default goodsReceiptsRouter
