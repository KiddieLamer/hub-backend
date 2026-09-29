import { Hono } from 'hono'
import { z } from 'zod'
import { eq, and, SQL, ilike, count } from 'drizzle-orm'
import { parsePagination, paginated } from '../../../lib/pagination'
import { db } from '../../../db'
import { invoices, invoiceItems, paymentsReceived } from '../../../db/schema'
import { authMiddleware, type Variables as AuthVariables } from '../../../middleware/auth'
import { requireModuleAccess } from '../../../middleware/rbac'
import { tenantMiddleware, type TenantVariables } from '../../../middleware/tenant'
import { validate, getValidated } from '../../../middleware/validate'

type Variables = AuthVariables & TenantVariables

const invoicesRouter = new Hono<{ Variables: Variables }>()
invoicesRouter.use('*', authMiddleware)
invoicesRouter.use('*', tenantMiddleware)
invoicesRouter.use('*', requireModuleAccess('finance:read', 'finance:write'))

const createInvoiceSchema = z.object({
  invoiceNumber: z.string().min(1).max(100),
  clientId: z.string().uuid(),
  issueDate: z.string(),
  dueDate: z.string(),
  taxRate: z.number().min(0).max(100).default(11),
  discountAmount: z.number().min(0).default(0),
  notes: z.string().optional(),
  items: z.array(z.object({
    catalogItemId: z.string().uuid().nullable().optional(),
    itemName: z.string().min(1).max(255),
    description: z.string().optional(),
    quantity: z.number().min(0),
    unitPrice: z.number().min(0),
  })).min(1),
})

const recordPaymentSchema = z.object({
  paymentNumber: z.string().min(1).max(100),
  amount: z.number().min(0),
  paymentDate: z.string().optional(),
  paymentMethod: z.enum(['bank_transfer', 'payment_gateway', 'cheque', 'cash']).default('bank_transfer'),
  referenceNumber: z.string().max(100).optional(),
  proofUrl: z.string().url().optional(),
})

// List invoices
invoicesRouter.get('/', async (c) => {
  const tenant = c.get('tenant')
  const { search, status, clientId } = c.req.query()
  const { page, limit, offset } = parsePagination(c)

  const conditions: SQL[] = [eq(invoices.tenantId, tenant.tenantId)]

  if (search) conditions.push(ilike(invoices.invoiceNumber, `%${search}%`))
  if (status) conditions.push(eq(invoices.status, status))
  if (clientId) conditions.push(eq(invoices.clientId, clientId))

  const where = and(...conditions)

  const [data, totalRows] = await Promise.all([
    db.query.invoices.findMany({
      where,
      orderBy: (fields, { desc }) => [desc(fields.createdAt)],
      limit,
      offset,
    }),
    db.select({ total: count() }).from(invoices).where(where),
  ])

  return c.json(paginated('invoices', data, totalRows[0]?.total ?? 0, { page, limit, offset }))
})

// Invoice stats
invoicesRouter.get('/stats', async (c) => {
  const tenant = c.get('tenant')

  const all = await db.query.invoices.findMany({
    where: eq(invoices.tenantId, tenant.tenantId),
    columns: { status: true, grandTotal: true, amountPaid: true },
  })

  const stats = {
    total: all.length,
    draft: all.filter((i) => i.status === 'draft').length,
    sent: all.filter((i) => i.status === 'sent').length,
    partiallyPaid: all.filter((i) => i.status === 'partially_paid').length,
    paid: all.filter((i) => i.status === 'paid').length,
    overdue: all.filter((i) => i.status === 'overdue').length,
    cancelled: all.filter((i) => i.status === 'cancelled').length,
    totalRevenue: all.reduce((sum, i) => sum + Number(i.grandTotal), 0),
    totalPaid: all.reduce((sum, i) => sum + Number(i.amountPaid), 0),
  }

  return c.json({ stats })
})

// Get invoice detail
invoicesRouter.get('/:id', async (c) => {
  const tenant = c.get('tenant')
  const { id } = c.req.param()

  const invoice = await db.query.invoices.findFirst({
    where: and(eq(invoices.id, id), eq(invoices.tenantId, tenant.tenantId)),
  })

  if (!invoice) return c.json({ error: 'Invoice not found' }, 404)

  const items = await db.query.invoiceItems.findMany({
    where: eq(invoiceItems.invoiceId, id),
  })

  const payments = await db.query.paymentsReceived.findMany({
    where: eq(paymentsReceived.invoiceId, id),
    orderBy: (fields, { desc }) => [desc(fields.paymentDate)],
  })

  return c.json({ invoice: { ...invoice, items, payments } })
})

// Create invoice
invoicesRouter.post('/', async (c) => {
  const tenant = c.get('tenant')
  const authUser = c.get('user')
  const body = getValidated<typeof createInvoiceSchema>(c, 'json')!

  // Calculate totals
  const subtotal = body.items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0)
  const taxAmount = subtotal * (body.taxRate / 100)
  const grandTotal = subtotal + taxAmount - body.discountAmount

  const [invoice] = await db.insert(invoices).values({
    ...body,
    tenantId: tenant.tenantId,
    createdBy: authUser.id,
    subtotal: String(subtotal),
    taxRate: String(body.taxRate),
    taxAmount: String(taxAmount),
    discountAmount: String(body.discountAmount),
    grandTotal: String(grandTotal),
  }).returning()

  // Insert items
  if (body.items.length > 0) {
    await db.insert(invoiceItems).values(
      body.items.map((item) => ({
        invoiceId: invoice.id,
        catalogItemId: item.catalogItemId || null,
        itemName: item.itemName,
        description: item.description,
        quantity: String(item.quantity),
        unitPrice: String(item.unitPrice),
        amount: String(item.quantity * item.unitPrice),
      }))
    )
  }

  return c.json({ invoice }, 201)
})

// Update invoice
invoicesRouter.patch('/:id', validate(createInvoiceSchema.partial(), 'json'), async (c) => {
  const tenant = c.get('tenant')
  const { id } = c.req.param()
  const body = getValidated<typeof createInvoiceSchema>(c, 'json')!

  const [updated] = await db
    .update(invoices)
    .set({
      ...body,
      taxRate: body.taxRate ? String(body.taxRate) : undefined,
      discountAmount: body.discountAmount ? String(body.discountAmount) : undefined,
      updatedAt: new Date(),
    })
    .where(and(eq(invoices.id, id), eq(invoices.tenantId, tenant.tenantId)))
    .returning()

  if (!updated) return c.json({ error: 'Invoice not found' }, 404)

  // Update items if provided
  if (body.items) {
    await db.delete(invoiceItems).where(eq(invoiceItems.invoiceId, id))

    if (body.items.length > 0) {
      await db.insert(invoiceItems).values(
        body.items.map((item) => ({
          invoiceId: id,
          catalogItemId: item.catalogItemId || null,
          itemName: item.itemName,
          description: item.description,
          quantity: String(item.quantity),
          unitPrice: String(item.unitPrice),
          amount: String(item.quantity * item.unitPrice),
        }))
      )
    }
  }

  return c.json({ invoice: updated })
})

// Record payment
invoicesRouter.post('/:id/payments', async (c) => {
  const tenant = c.get('tenant')
  const authUser = c.get('user')
  const { id } = c.req.param()
  const body = getValidated<typeof recordPaymentSchema>(c, 'json')!

  const invoice = await db.query.invoices.findFirst({
    where: and(eq(invoices.id, id), eq(invoices.tenantId, tenant.tenantId)),
  })

  if (!invoice) return c.json({ error: 'Invoice not found' }, 404)
  if (invoice.status === 'cancelled') return c.json({ error: 'Invoice is cancelled' }, 400)

  // Create payment record
  const [payment] = await db.insert(paymentsReceived).values({
    ...body,
    invoiceId: id,
    receivedBy: authUser.id,
    amount: String(body.amount),
    paymentDate: body.paymentDate ? new Date(body.paymentDate) : new Date(),
  }).returning()

  // Update invoice amount_paid and status
  const newAmountPaid = Number(invoice.amountPaid) + body.amount
  const newStatus = newAmountPaid >= Number(invoice.grandTotal) ? 'paid' : 'partially_paid'

  await db
    .update(invoices)
    .set({
      amountPaid: String(newAmountPaid),
      status: newStatus,
      updatedAt: new Date(),
    })
    .where(eq(invoices.id, id))

  return c.json({ payment }, 201)
})

// Update invoice status
const updateInvoiceStatusSchema = z.object({
  status: z.enum(['draft', 'sent', 'paid', 'overdue', 'cancelled']),
})

invoicesRouter.post('/:id/status', validate(updateInvoiceStatusSchema, 'json'), async (c) => {
  const tenant = c.get('tenant')
  const { id } = c.req.param()
  const { status } = getValidated<typeof updateInvoiceStatusSchema>(c, 'json')!

  const [updated] = await db
    .update(invoices)
    .set({ status, updatedAt: new Date() })
    .where(and(eq(invoices.id, id), eq(invoices.tenantId, tenant.tenantId)))
    .returning()

  if (!updated) return c.json({ error: 'Invoice not found' }, 404)

  return c.json({ invoice: updated })
})

// Delete invoice (soft delete)
invoicesRouter.delete('/:id', async (c) => {
  const tenant = c.get('tenant')
  const { id } = c.req.param()

  const [deleted] = await db
    .update(invoices)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(invoices.id, id), eq(invoices.tenantId, tenant.tenantId)))
    .returning()

  if (!deleted) return c.json({ error: 'Invoice not found' }, 404)

  return c.json({ message: 'Invoice deleted' })
})

export default invoicesRouter
