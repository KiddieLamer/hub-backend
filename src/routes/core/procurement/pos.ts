import { Hono } from 'hono'
import { z } from 'zod'
import { eq, and, SQL, ilike } from 'drizzle-orm'
import { db } from '../../../db'
import { pos, poItems, stockMovements, catalogItems } from '../../../db/schema'
import { authMiddleware, type Variables as AuthVariables } from '../../../middleware/auth'
import { tenantMiddleware, type TenantVariables } from '../../../middleware/tenant'

type Variables = AuthVariables & TenantVariables

const posRouter = new Hono<{ Variables: Variables }>()
posRouter.use('*', authMiddleware)
posRouter.use('*', tenantMiddleware)

const poStatusSchema = z.object({
  status: z.enum(['draft', 'pending_approval', 'approved', 'ordered', 'partially_received', 'received', 'cancelled']),
})

const createPoSchema = z.object({
  poNumber: z.string().min(1).max(100),
  supplierId: z.string().uuid(),
  projectId: z.string().uuid().optional(),
  orderDate: z.string(),
  expectedDeliveryDate: z.string().optional(),
  notes: z.string().optional(),
  items: z.array(z.object({
    catalogItemId: z.string().uuid(),
    quantityOrdered: z.number().min(1),
    unitCost: z.number().min(0),
  })).min(1),
})

const receiveItemsSchema = z.object({
  items: z.array(z.object({
    poItemId: z.string().uuid(),
    quantityReceived: z.number().min(1),
  })),
})

// List POs
posRouter.get('/', async (c) => {
  const tenant = c.get('tenant')
  const { search, status, supplierId } = c.req.query()

  const conditions: SQL[] = [eq(pos.tenantId, tenant.tenantId)]

  if (search) conditions.push(ilike(pos.poNumber, `%${search}%`))
  if (status) conditions.push(eq(pos.status, status))
  if (supplierId) conditions.push(eq(pos.supplierId, supplierId))

  const data = await db.query.pos.findMany({
    where: and(...conditions),
    orderBy: (fields, { desc }) => [desc(fields.createdAt)],
  })

  return c.json({ purchaseOrders: data, total: data.length })
})

// PO stats
posRouter.get('/stats', async (c) => {
  const tenant = c.get('tenant')

  const all = await db.query.pos.findMany({
    where: eq(pos.tenantId, tenant.tenantId),
    columns: { status: true, totalAmount: true },
  })

  const stats = {
    total: all.length,
    draft: all.filter((p) => p.status === 'draft').length,
    pendingApproval: all.filter((p) => p.status === 'pending_approval').length,
    approved: all.filter((p) => p.status === 'approved').length,
    ordered: all.filter((p) => p.status === 'ordered').length,
    partiallyReceived: all.filter((p) => p.status === 'partially_received').length,
    received: all.filter((p) => p.status === 'received').length,
    cancelled: all.filter((p) => p.status === 'cancelled').length,
    totalAmount: all.reduce((sum, p) => sum + Number(p.totalAmount), 0),
  }

  return c.json({ stats })
})

// Get PO detail
posRouter.get('/:id', async (c) => {
  const tenant = c.get('tenant')
  const { id } = c.req.param()

  const po = await db.query.pos.findFirst({
    where: and(eq(pos.id, id), eq(pos.tenantId, tenant.tenantId)),
  })

  if (!po) return c.json({ error: 'PO not found' }, 404)

  const items = await db.query.poItems.findMany({
    where: eq(poItems.poId, id),
  })

  return c.json({ purchaseOrder: { ...po, items } })
})

// Create PO
posRouter.post('/', async (c) => {
  const tenant = c.get('tenant')
  const authUser = c.get('user')
  const body = createPoSchema.parse(await c.req.json())

  // Calculate total
  const totalAmount = body.items.reduce((sum, item) => sum + item.quantityOrdered * item.unitCost, 0)

  const [po] = await db.insert(pos).values({
    ...body,
    tenantId: tenant.tenantId,
    createdBy: authUser.id,
    totalAmount: String(totalAmount),
  }).returning()

  // Insert items
  if (body.items.length > 0) {
    await db.insert(poItems).values(
      body.items.map((item) => ({
        poId: po.id,
        catalogItemId: item.catalogItemId,
        quantityOrdered: item.quantityOrdered,
        unitCost: String(item.unitCost),
        totalCost: String(item.quantityOrdered * item.unitCost),
      }))
    )
  }

  return c.json({ purchaseOrder: po }, 201)
})

// Update PO status
posRouter.post('/:id/status', async (c) => {
  const tenant = c.get('tenant')
  const authUser = c.get('user')
  const { id } = c.req.param()
  const { status } = poStatusSchema.parse(await c.req.json())

  const updateData: Record<string, unknown> = { status, updatedAt: new Date() }

  if (status === 'approved') {
    updateData.approvedBy = authUser.id
  }

  const [updated] = await db
    .update(pos)
    .set(updateData)
    .where(and(eq(pos.id, id), eq(pos.tenantId, tenant.tenantId)))
    .returning()

  if (!updated) return c.json({ error: 'PO not found' }, 404)

  return c.json({ purchaseOrder: updated })
})

// Receive items
posRouter.post('/:id/receive', async (c) => {
  const tenant = c.get('tenant')
  const authUser = c.get('user')
  const { id } = c.req.param()
  const body = receiveItemsSchema.parse(await c.req.json())

  const po = await db.query.pos.findFirst({
    where: and(eq(pos.id, id), eq(pos.tenantId, tenant.tenantId)),
  })

  if (!po) return c.json({ error: 'PO not found' }, 404)

  // Update each item's quantity received
  for (const item of body.items) {
    const poItem = await db.query.poItems.findFirst({
      where: eq(poItems.id, item.poItemId),
    })

    if (!poItem) continue

    const newQuantityReceived = poItem.quantityReceived + item.quantityReceived

    await db
      .update(poItems)
      .set({ quantityReceived: newQuantityReceived })
      .where(eq(poItems.id, item.poItemId))

    // Create stock movement
    const catalogItem = await db.query.catalogItems.findFirst({
      where: eq(catalogItems.id, poItem.catalogItemId),
    })

    if (catalogItem) {
      const stockBefore = catalogItem.stockQuantity
      const stockAfter = stockBefore + item.quantityReceived

      await db.insert(stockMovements).values({
        catalogItemId: poItem.catalogItemId,
        movementType: 'in_purchase',
        quantity: item.quantityReceived,
        stockBefore,
        stockAfter,
        referencePoId: id,
        performedBy: authUser.id,
        notes: `PO ${po.poNumber} received`,
      })

      // Update catalog item stock
      await db
        .update(catalogItems)
        .set({ stockQuantity: stockAfter, updatedAt: new Date() })
        .where(eq(catalogItems.id, poItem.catalogItemId))
    }
  }

  // Check if all items received
  const allItems = await db.query.poItems.findMany({
    where: eq(poItems.poId, id),
  })

  const allReceived = allItems.every((item) => item.quantityReceived >= item.quantityOrdered)
  const someReceived = allItems.some((item) => item.quantityReceived > 0)

  const newStatus = allReceived ? 'received' : someReceived ? 'partially_received' : po.status

  await db
    .update(pos)
    .set({ status: newStatus, updatedAt: new Date() })
    .where(eq(pos.id, id))

  return c.json({ message: 'Items received', status: newStatus })
})

// Delete PO
posRouter.delete('/:id', async (c) => {
  const tenant = c.get('tenant')
  const { id } = c.req.param()

  const [deleted] = await db
    .update(pos)
    .set({ status: 'cancelled', updatedAt: new Date() })
    .where(and(eq(pos.id, id), eq(pos.tenantId, tenant.tenantId)))
    .returning()

  if (!deleted) return c.json({ error: 'PO not found' }, 404)

  return c.json({ message: 'PO cancelled' })
})

export default posRouter
