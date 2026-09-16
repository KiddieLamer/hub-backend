import { Hono } from 'hono'
import { z } from 'zod'
import { eq, and, SQL, ilike } from 'drizzle-orm'
import { db } from '../../../db'
import { purchaseOrders } from '../../../db/schema'
import { authMiddleware, type Variables as AuthVariables } from '../../../middleware/auth'
import { tenantMiddleware, type TenantVariables } from '../../../middleware/tenant'

type Variables = AuthVariables & TenantVariables

const purchaseOrdersRouter = new Hono<{ Variables: Variables }>()
purchaseOrdersRouter.use('*', authMiddleware)
purchaseOrdersRouter.use('*', tenantMiddleware)

const createPOSchema = z.object({
  poNumber: z.string().min(1).max(100),
  prId: z.string().uuid().optional(),
  vendorId: z.string().uuid(),
  subtotal: z.number().min(0),
  taxAmount: z.number().min(0).default(0),
  discountAmount: z.number().min(0).default(0),
  grandTotal: z.number().min(0),
  paymentTerms: z.string().max(100).optional(),
  status: z.enum(['draft', 'sent_to_vendor', 'partially_received', 'fully_received', 'cancelled']).default('draft'),
  expectedDeliveryDate: z.string().optional(),
})

// List POs
purchaseOrdersRouter.get('/', async (c) => {
  const tenant = c.get('tenant')
  const { search, status } = c.req.query()

  const conditions: SQL[] = [eq(purchaseOrders.tenantId, tenant.tenantId)]

  if (search) conditions.push(ilike(purchaseOrders.poNumber, `%${search}%`))
  if (status) conditions.push(eq(purchaseOrders.status, status))

  const data = await db.query.purchaseOrders.findMany({
    where: and(...conditions),
    orderBy: (fields, { desc }) => [desc(fields.createdAt)],
  })

  return c.json({ purchaseOrders: data, total: data.length })
})

// PO stats
purchaseOrdersRouter.get('/stats', async (c) => {
  const tenant = c.get('tenant')

  const allPOs = await db.query.purchaseOrders.findMany({
    where: eq(purchaseOrders.tenantId, tenant.tenantId),
    columns: { status: true },
  })

  const stats = {
    total: allPOs.length,
    draft: allPOs.filter((p) => p.status === 'draft').length,
    sentToVendor: allPOs.filter((p) => p.status === 'sent_to_vendor').length,
    partiallyReceived: allPOs.filter((p) => p.status === 'partially_received').length,
    fullyReceived: allPOs.filter((p) => p.status === 'fully_received').length,
    cancelled: allPOs.filter((p) => p.status === 'cancelled').length,
  }

  return c.json({ stats })
})

// Get PO detail
purchaseOrdersRouter.get('/:id', async (c) => {
  const tenant = c.get('tenant')
  const { id } = c.req.param()

  const po = await db.query.purchaseOrders.findFirst({
    where: and(eq(purchaseOrders.id, id), eq(purchaseOrders.tenantId, tenant.tenantId)),
  })

  if (!po) return c.json({ error: 'Purchase order not found' }, 404)

  return c.json({ purchaseOrder: po })
})

// Create PO
purchaseOrdersRouter.post('/', async (c) => {
  const tenant = c.get('tenant')
  const authUser = c.get('user')
  const body = createPOSchema.parse(await c.req.json())

  const [po] = await db.insert(purchaseOrders).values({
    ...body,
    tenantId: tenant.tenantId,
    issuedBy: authUser.id,
    subtotal: String(body.subtotal),
    taxAmount: String(body.taxAmount),
    discountAmount: String(body.discountAmount),
    grandTotal: String(body.grandTotal),
  }).returning()

  return c.json({ purchaseOrder: po }, 201)
})

// Update PO
purchaseOrdersRouter.patch('/:id', async (c) => {
  const tenant = c.get('tenant')
  const { id } = c.req.param()
  const body = createPOSchema.partial().parse(await c.req.json())

  const [updated] = await db
    .update(purchaseOrders)
    .set({
      ...body,
      subtotal: body.subtotal ? String(body.subtotal) : undefined,
      taxAmount: body.taxAmount ? String(body.taxAmount) : undefined,
      discountAmount: body.discountAmount ? String(body.discountAmount) : undefined,
      grandTotal: body.grandTotal ? String(body.grandTotal) : undefined,
      updatedAt: new Date(),
    })
    .where(and(eq(purchaseOrders.id, id), eq(purchaseOrders.tenantId, tenant.tenantId)))
    .returning()

  if (!updated) return c.json({ error: 'Purchase order not found' }, 404)

  return c.json({ purchaseOrder: updated })
})

// Delete PO (soft delete)
purchaseOrdersRouter.delete('/:id', async (c) => {
  const tenant = c.get('tenant')
  const { id } = c.req.param()

  const [deleted] = await db
    .update(purchaseOrders)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(purchaseOrders.id, id), eq(purchaseOrders.tenantId, tenant.tenantId)))
    .returning()

  if (!deleted) return c.json({ error: 'Purchase order not found' }, 404)

  return c.json({ message: 'Purchase order deleted' })
})

export default purchaseOrdersRouter
