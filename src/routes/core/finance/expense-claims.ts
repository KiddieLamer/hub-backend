import { Hono } from 'hono'
import { z } from 'zod'
import { eq, and, SQL, ilike } from 'drizzle-orm'
import { db } from '../../../db'
import { expenseClaims, departmentBudgets } from '../../../db/schema'
import { authMiddleware, type Variables as AuthVariables } from '../../../middleware/auth'
import { tenantMiddleware, type TenantVariables } from '../../../middleware/tenant'

type Variables = AuthVariables & TenantVariables

const expenseClaimsRouter = new Hono<{ Variables: Variables }>()
expenseClaimsRouter.use('*', authMiddleware)
expenseClaimsRouter.use('*', tenantMiddleware)

const createClaimSchema = z.object({
  expenseNumber: z.string().min(1).max(100),
  categoryId: z.string().uuid(),
  clientId: z.string().uuid().optional(),
  department: z.string().max(100).optional(),
  title: z.string().min(1).max(255),
  amount: z.number().min(0),
  expenseDate: z.string(),
  paymentMethod: z.enum(['reimbursement', 'company_card', 'petty_cash', 'bank_transfer']).default('reimbursement'),
  merchantName: z.string().max(255).optional(),
  receiptUrl: z.string().url().optional(),
  notes: z.string().optional(),
})

const approveSchema = z.object({
  approved: z.boolean(),
  rejectionReason: z.string().optional(),
})

const paySchema = z.object({
  paymentDate: z.string(),
})

// List claims
expenseClaimsRouter.get('/', async (c) => {
  const tenant = c.get('tenant')
  const { search, status, category, department } = c.req.query()

  const conditions: SQL[] = [eq(expenseClaims.tenantId, tenant.tenantId)]

  if (search) conditions.push(ilike(expenseClaims.title, `%${search}%`))
  if (status) conditions.push(eq(expenseClaims.status, status))
  if (category) conditions.push(eq(expenseClaims.categoryId, category))
  if (department) conditions.push(eq(expenseClaims.department, department))

  const data = await db.query.expenseClaims.findMany({
    where: and(...conditions),
    orderBy: (fields, { desc }) => [desc(fields.createdAt)],
  })

  return c.json({ claims: data, total: data.length })
})

// Stats
expenseClaimsRouter.get('/stats', async (c) => {
  const tenant = c.get('tenant')

  const allClaims = await db.query.expenseClaims.findMany({
    where: eq(expenseClaims.tenantId, tenant.tenantId),
    columns: { status: true, amount: true, department: true },
  })

  const stats = {
    total: allClaims.length,
    draft: allClaims.filter((c) => c.status === 'draft').length,
    submitted: allClaims.filter((c) => c.status === 'submitted').length,
    approved: allClaims.filter((c) => c.status === 'approved').length,
    rejected: allClaims.filter((c) => c.status === 'rejected').length,
    paid: allClaims.filter((c) => c.status === 'paid').length,
    totalAmount: allClaims.reduce((sum, c) => sum + Number(c.amount), 0),
  }

  return c.json({ stats })
})

// Get claim detail
expenseClaimsRouter.get('/:id', async (c) => {
  const tenant = c.get('tenant')
  const { id } = c.req.param()

  const claim = await db.query.expenseClaims.findFirst({
    where: and(eq(expenseClaims.id, id), eq(expenseClaims.tenantId, tenant.tenantId)),
  })

  if (!claim) return c.json({ error: 'Expense claim not found' }, 404)

  return c.json({ claim })
})

// Create claim
expenseClaimsRouter.post('/', async (c) => {
  const tenant = c.get('tenant')
  const authUser = c.get('user')
  const body = createClaimSchema.parse(await c.req.json())

  const [claim] = await db.insert(expenseClaims).values({
    ...body,
    tenantId: tenant.tenantId,
    submittedBy: authUser.id,
    amount: String(body.amount),
  }).returning()

  return c.json({ claim }, 201)
})

// Update claim
expenseClaimsRouter.patch('/:id', async (c) => {
  const tenant = c.get('tenant')
  const { id } = c.req.param()
  const body = createClaimSchema.partial().parse(await c.req.json())

  const [updated] = await db
    .update(expenseClaims)
    .set({
      ...body,
      amount: body.amount ? String(body.amount) : undefined,
      updatedAt: new Date(),
    })
    .where(and(eq(expenseClaims.id, id), eq(expenseClaims.tenantId, tenant.tenantId)))
    .returning()

  if (!updated) return c.json({ error: 'Expense claim not found' }, 404)

  return c.json({ claim: updated })
})

// Approve/Reject claim
expenseClaimsRouter.post('/:id/approve', async (c) => {
  const tenant = c.get('tenant')
  const authUser = c.get('user')
  const { id } = c.req.param()
  const body = approveSchema.parse(await c.req.json())

  const claim = await db.query.expenseClaims.findFirst({
    where: and(eq(expenseClaims.id, id), eq(expenseClaims.tenantId, tenant.tenantId)),
  })

  if (!claim) return c.json({ error: 'Expense claim not found' }, 404)
  if (claim.status !== 'submitted') return c.json({ error: 'Claim is not in submitted status' }, 400)

  const newStatus = body.approved ? 'approved' : 'rejected'

  const [updated] = await db
    .update(expenseClaims)
    .set({
      status: newStatus,
      approvedBy: body.approved ? authUser.id : null,
      approvalDate: body.approved ? new Date() : null,
      rejectionReason: body.approved ? null : body.rejectionReason,
      updatedAt: new Date(),
    })
    .where(eq(expenseClaims.id, id))
    .returning()

  // Update used budget if approved
  if (body.approved && claim.department) {
    const now = new Date()
    const month = now.getMonth() + 1
    const year = now.getFullYear()

    const existingBudget = await db.query.departmentBudgets.findFirst({
      where: and(
        eq(departmentBudgets.tenantId, tenant.tenantId),
        eq(departmentBudgets.department, claim.department),
        eq(departmentBudgets.periodMonth, month),
        eq(departmentBudgets.periodYear, year),
      ),
    })

    if (existingBudget) {
      const newUsed = Number(existingBudget.usedBudget) + Number(claim.amount)
      await db
        .update(departmentBudgets)
        .set({ usedBudget: String(newUsed), updatedAt: new Date() })
        .where(eq(departmentBudgets.id, existingBudget.id))
    }
  }

  return c.json({ claim: updated })
})

// Mark as paid
expenseClaimsRouter.post('/:id/pay', async (c) => {
  const tenant = c.get('tenant')
  const authUser = c.get('user')
  const { id } = c.req.param()
  const body = paySchema.parse(await c.req.json())

  const claim = await db.query.expenseClaims.findFirst({
    where: and(eq(expenseClaims.id, id), eq(expenseClaims.tenantId, tenant.tenantId)),
  })

  if (!claim) return c.json({ error: 'Expense claim not found' }, 404)
  if (claim.status !== 'approved') return c.json({ error: 'Claim is not approved yet' }, 400)

  const [updated] = await db
    .update(expenseClaims)
    .set({
      status: 'paid',
      paidBy: authUser.id,
      paymentDate: new Date(body.paymentDate),
      updatedAt: new Date(),
    })
    .where(eq(expenseClaims.id, id))
    .returning()

  return c.json({ claim: updated })
})

// Delete claim (soft delete)
expenseClaimsRouter.delete('/:id', async (c) => {
  const tenant = c.get('tenant')
  const { id } = c.req.param()

  const [deleted] = await db
    .update(expenseClaims)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(expenseClaims.id, id), eq(expenseClaims.tenantId, tenant.tenantId)))
    .returning()

  if (!deleted) return c.json({ error: 'Expense claim not found' }, 404)

  return c.json({ message: 'Expense claim deleted' })
})

export default expenseClaimsRouter
