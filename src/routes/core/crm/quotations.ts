import { Hono } from 'hono'
import { z } from 'zod'
import { eq, and, or, ilike } from 'drizzle-orm'
import { db } from '../../../db'
import { quotations, quotationItems, invoices, projects } from '../../../db/schema'
import { authMiddleware, type Variables as AuthVariables } from '../../../middleware/auth'
import { requireModuleAccess } from '../../../middleware/rbac'
import { tenantMiddleware, type TenantVariables } from '../../../middleware/tenant'

type Variables = AuthVariables & TenantVariables

const quotationRouter = new Hono<{ Variables: Variables }>()

quotationRouter.use('*', authMiddleware)
quotationRouter.use('*', tenantMiddleware)
quotationRouter.use('*', requireModuleAccess('crm:read', 'crm:write'))

const createItemSchema = z.object({
  catalogItemId: z.string().uuid().nullable().optional(),
  itemName: z.string().min(1).max(255),
  description: z.string().nullable().optional(),
  quantity: z.string().min(1),
  unit: z.string().max(50).default('pcs'),
  unitPrice: z.string().min(1),
  unitCostPrice: z.string().default('0.00'),
})

const createQuotationSchema = z.object({
  clientId: z.string().uuid(),
  title: z.string().min(1).max(255),
  issueDate: z.string().min(1),
  validUntil: z.string().min(1),
  discountAmount: z.string().default('0.00'),
  taxAmount: z.string().default('0.00'),
  notes: z.string().nullable().optional(),
  items: z.array(createItemSchema).min(1),
})

quotationRouter.get('/', async (c) => {
  const tenant = c.get('tenant')
  const { search, status } = c.req.query()

  let whereClause: any = eq(quotations.tenantId, tenant.tenantId)

  if (search) {
    whereClause = and(
      whereClause,
      or(
        ilike(quotations.quotationNumber, `%${search}%`),
        ilike(quotations.title, `%${search}%`)
      )
    )
  }
  if (status) {
    whereClause = and(whereClause, eq(quotations.status, status))
  }

  const data = await db.query.quotations.findMany({
    where: whereClause,
    orderBy: (fields: any, { desc: d }: any) => [d(fields.createdAt)],
  })

  return c.json({ quotations: data, total: data.length })
})

quotationRouter.get('/stats', async (c) => {
  const tenant = c.get('tenant')

  const allQuotations = await db.query.quotations.findMany({
    where: eq(quotations.tenantId, tenant.tenantId),
    columns: { status: true, grandTotal: true },
  })

  const stats = {
    total: allQuotations.length,
    draft: allQuotations.filter((q: any) => q.status === 'draft').length,
    sent: allQuotations.filter((q: any) => q.status === 'sent').length,
    accepted: allQuotations.filter((q: any) => q.status === 'accepted').length,
    declined: allQuotations.filter((q: any) => q.status === 'declined').length,
    expired: allQuotations.filter((q: any) => q.status === 'expired').length,
    converted: allQuotations.filter((q: any) => q.status === 'converted_to_invoice').length,
    totalValue: allQuotations.reduce((sum: number, q: any) => sum + parseFloat(q.grandTotal), 0),
  }

  return c.json({ stats })
})

quotationRouter.get('/:id', async (c) => {
  const tenant = c.get('tenant')
  const { id } = c.req.param()

  const quotation = await db.query.quotations.findFirst({
    where: and(eq(quotations.id, id), eq(quotations.tenantId, tenant.tenantId)),
    with: {
      items: true,
    },
  })

  if (!quotation) {
    return c.json({ error: 'Quotation not found' }, 404)
  }

  return c.json({ quotation })
})

quotationRouter.post('/', async (c) => {
  const tenant = c.get('tenant')
  const user = c.get('user')
  const body = createQuotationSchema.parse(await c.req.json())

  const now = new Date()
  const datePart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const rand = String(Math.floor(Math.random() * 10000)).padStart(4, '0')
  const quotationNumber = `QUO-${datePart}-${Date.now()}-${rand}`

  let subtotal = '0.00'
  const itemsData = body.items.map((item) => {
    const total = parseFloat(item.quantity) * parseFloat(item.unitPrice)
    subtotal = (parseFloat(subtotal) + total).toFixed(2)
    return {
      ...item,
      totalPrice: total.toFixed(2),
    }
  })

  const grandTotal = (
    parseFloat(subtotal) -
    parseFloat(body.discountAmount) +
    parseFloat(body.taxAmount)
  ).toFixed(2)

  const [quotation] = await db
    .insert(quotations)
    .values({
      tenantId: tenant.tenantId,
      quotationNumber,
      clientId: body.clientId,
      createdBy: user.id,
      title: body.title,
      issueDate: body.issueDate,
      validUntil: body.validUntil,
      subtotal,
      discountAmount: body.discountAmount,
      taxAmount: body.taxAmount,
      grandTotal,
      notes: body.notes,
    })
    .returning()

  for (const item of itemsData) {
    await db.insert(quotationItems).values({
      quotationId: quotation.id,
      catalogItemId: item.catalogItemId || null,
      itemName: item.itemName,
      description: item.description || null,
      quantity: item.quantity,
      unit: item.unit,
      unitPrice: item.unitPrice,
      unitCostPrice: item.unitCostPrice,
      totalPrice: item.totalPrice,
    })
  }

  const result = await db.query.quotations.findFirst({
    where: eq(quotations.id, quotation.id),
    with: { items: true },
  })

  return c.json({ quotation: result }, 201)
})

quotationRouter.patch('/:id', async (c) => {
  const tenant = c.get('tenant')
  const { id } = c.req.param()
  const body = createQuotationSchema.partial().parse(await c.req.json())

  const updateData: Record<string, any> = { updatedAt: new Date() }
  if (body.clientId) updateData.clientId = body.clientId
  if (body.title) updateData.title = body.title
  if (body.issueDate) updateData.issueDate = body.issueDate
  if (body.validUntil) updateData.validUntil = body.validUntil
  if (body.discountAmount) updateData.discountAmount = body.discountAmount
  if (body.taxAmount) updateData.taxAmount = body.taxAmount
  if (body.notes !== undefined) updateData.notes = body.notes

  if (body.items) {
    await db.delete(quotationItems).where(eq(quotationItems.quotationId, id))
    for (const item of body.items) {
      const total = parseFloat(item.quantity) * parseFloat(item.unitPrice)
      await db.insert(quotationItems).values({
        quotationId: id,
        catalogItemId: item.catalogItemId || null,
        itemName: item.itemName,
        description: item.description || null,
        quantity: item.quantity,
        unit: item.unit,
        unitPrice: item.unitPrice,
        unitCostPrice: item.unitCostPrice,
        totalPrice: total.toFixed(2),
      })
    }
  }

  const existing = await db.query.quotations.findFirst({
    where: and(eq(quotations.id, id), eq(quotations.tenantId, tenant.tenantId)),
  })
  if (!existing) return c.json({ error: 'Quotation not found' }, 404)

  const newSubtotal = body.items
    ? body.items.reduce((sum: number, item: any) => sum + parseFloat(item.quantity) * parseFloat(item.unitPrice), 0).toFixed(2)
    : existing.subtotal
  const newDiscount = body.discountAmount || existing.discountAmount
  const newTax = body.taxAmount || existing.taxAmount
  updateData.subtotal = newSubtotal
  updateData.grandTotal = (parseFloat(newSubtotal) - parseFloat(newDiscount) + parseFloat(newTax)).toFixed(2)

  const [updated] = await db
    .update(quotations)
    .set(updateData)
    .where(and(eq(quotations.id, id), eq(quotations.tenantId, tenant.tenantId)))
    .returning()

  const result = await db.query.quotations.findFirst({
    where: eq(quotations.id, updated.id),
    with: { items: true },
  })

  return c.json({ quotation: result })
})

quotationRouter.post('/:id/status', async (c) => {
  const tenant = c.get('tenant')
  const { id } = c.req.param()
  const { status, rejectionReason } = await c.req.json()

  const validStatuses = ['draft', 'sent', 'accepted', 'declined', 'expired', 'converted_to_invoice']
  if (!validStatuses.includes(status)) {
    return c.json({ error: 'Invalid status' }, 400)
  }

  const updateData: Record<string, any> = { status, updatedAt: new Date() }
  if (status === 'declined' && rejectionReason) {
    updateData.rejectionReason = rejectionReason
  }

  const [updated] = await db
    .update(quotations)
    .set(updateData)
    .where(and(eq(quotations.id, id), eq(quotations.tenantId, tenant.tenantId)))
    .returning()

  if (!updated) {
    return c.json({ error: 'Quotation not found' }, 404)
  }

  return c.json({ quotation: updated })
})

quotationRouter.post('/:id/convert-to-invoice', async (c) => {
  const tenant = c.get('tenant')
  const user = c.get('user')
  const { id } = c.req.param()

  const quotation = await db.query.quotations.findFirst({
    where: and(eq(quotations.id, id), eq(quotations.tenantId, tenant.tenantId)),
    with: { items: true },
  })

  if (!quotation) return c.json({ error: 'Quotation not found' }, 404)
  if (quotation.status !== 'accepted') return c.json({ error: 'Quotation must be accepted first' }, 400)

  const now = new Date()
  const datePart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const seq = String(1).padStart(3, '0')
  const invoiceNumber = `INV-${datePart}-${seq}`

  const [invoice] = await db
    .insert(invoices)
    .values({
      tenantId: tenant.tenantId,
      invoiceNumber,
      clientId: quotation.clientId,
      createdBy: user.id,
      issueDate: now.toISOString().split('T')[0],
      dueDate: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      subtotal: quotation.subtotal,
      discountAmount: quotation.discountAmount,
      taxAmount: quotation.taxAmount,
      grandTotal: quotation.grandTotal,
      notes: quotation.notes,
    })
    .returning()

  await db
    .update(quotations)
    .set({ status: 'converted_to_invoice', convertedInvoiceId: invoice.id, updatedAt: new Date() })
    .where(eq(quotations.id, id))

  return c.json({ invoice }, 201)
})

quotationRouter.post('/:id/convert-to-project', async (c) => {
  const tenant = c.get('tenant')
  const user = c.get('user')
  const { id } = c.req.param()

  const quotation = await db.query.quotations.findFirst({
    where: and(eq(quotations.id, id), eq(quotations.tenantId, tenant.tenantId)),
    with: { items: true },
  })

  if (!quotation) return c.json({ error: 'Quotation not found' }, 404)
  if (quotation.status !== 'accepted') return c.json({ error: 'Quotation must be accepted first' }, 400)

  const now = new Date()
  const projectCode = `PRJ-${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(Math.floor(Math.random() * 1000)).padStart(3, '0')}`

  const [project] = await db
    .insert(projects)
    .values({
      tenantId: tenant.tenantId,
      projectCode,
      name: quotation.title,
      description: `Proyek dari penawaran ${quotation.quotationNumber}`,
      clientId: quotation.clientId,
      projectManagerId: user.id,
      createdBy: user.id,
      startDate: new Date().toISOString().split('T')[0],
      endDate: quotation.validUntil,
      budget: quotation.grandTotal,
      status: 'planning',
    })
    .returning()

  return c.json({ project }, 201)
})

quotationRouter.delete('/:id', async (c) => {
  const tenant = c.get('tenant')
  const { id } = c.req.param()

  await db.delete(quotationItems).where(eq(quotationItems.quotationId, id))

  const [deleted] = await db
    .delete(quotations)
    .where(and(eq(quotations.id, id), eq(quotations.tenantId, tenant.tenantId)))
    .returning()

  if (!deleted) {
    return c.json({ error: 'Quotation not found' }, 404)
  }

  return c.json({ message: 'Quotation deleted' })
})

export default quotationRouter
