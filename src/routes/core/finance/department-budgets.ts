import { Hono } from 'hono'
import { z } from 'zod'
import { eq, and, SQL, count } from 'drizzle-orm'
import { db } from '../../../db'
import { departmentBudgets } from '../../../db/schema'
import { authMiddleware, type Variables as AuthVariables } from '../../../middleware/auth'
import { requireModuleAccess } from '../../../middleware/rbac'
import { tenantMiddleware, type TenantVariables } from '../../../middleware/tenant'
import { parsePagination, paginated } from '../../../lib/pagination'
import { validate, getValidated } from '../../../middleware/validate'

type Variables = AuthVariables & TenantVariables

const departmentBudgetsRouter = new Hono<{ Variables: Variables }>()
departmentBudgetsRouter.use('*', authMiddleware)
departmentBudgetsRouter.use('*', tenantMiddleware)
departmentBudgetsRouter.use('*', requireModuleAccess('finance:read', 'finance:write'))

const createBudgetSchema = z.object({
  department: z.string().min(1).max(100),
  periodMonth: z.number().min(1).max(12),
  periodYear: z.number().min(2000),
  allocatedBudget: z.number().min(0),
})

// List budgets
departmentBudgetsRouter.get('/', async (c) => {
  const tenant = c.get('tenant')
  const { month, year } = c.req.query()
  const pagination = parsePagination(c)

  const conditions: SQL[] = [eq(departmentBudgets.tenantId, tenant.tenantId)]

  if (month) conditions.push(eq(departmentBudgets.periodMonth, Number(month)))
  if (year) conditions.push(eq(departmentBudgets.periodYear, Number(year)))

  const where = and(...conditions)

  const [data, [{ value: total }]] = await Promise.all([
    db.query.departmentBudgets.findMany({
      where,
      orderBy: (fields, { asc }) => [asc(fields.department)],
      limit: pagination.limit,
      offset: pagination.offset,
    }),
    db.select({ value: count() }).from(departmentBudgets).where(where),
  ])

  return c.json(paginated('budgets', data, Number(total), pagination))
})

// Get budget detail
departmentBudgetsRouter.get('/:id', async (c) => {
  const tenant = c.get('tenant')
  const { id } = c.req.param()

  const budget = await db.query.departmentBudgets.findFirst({
    where: and(eq(departmentBudgets.id, id), eq(departmentBudgets.tenantId, tenant.tenantId)),
  })

  if (!budget) return c.json({ error: 'Budget not found' }, 404)

  return c.json({ budget })
})

// Create or update budget
departmentBudgetsRouter.post('/', async (c) => {
  const tenant = c.get('tenant')
  const body = getValidated<typeof createBudgetSchema>(c, 'json')!

  // Check if budget already exists for this department/period
  const existing = await db.query.departmentBudgets.findFirst({
    where: and(
      eq(departmentBudgets.tenantId, tenant.tenantId),
      eq(departmentBudgets.department, body.department),
      eq(departmentBudgets.periodMonth, body.periodMonth),
      eq(departmentBudgets.periodYear, body.periodYear),
    ),
  })

  if (existing) {
    // Update existing
    const [updated] = await db
      .update(departmentBudgets)
      .set({
        allocatedBudget: String(body.allocatedBudget),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(departmentBudgets.id, existing.id),
          eq(departmentBudgets.tenantId, tenant.tenantId),
        ),
      )
      .returning()

    return c.json({ budget: updated })
  }

  // Create new
  const [budget] = await db.insert(departmentBudgets).values({
    ...body,
    tenantId: tenant.tenantId,
    allocatedBudget: String(body.allocatedBudget),
  }).returning()

  return c.json({ budget }, 201)
})

// Update budget
departmentBudgetsRouter.patch('/:id', validate(createBudgetSchema.partial(), 'json'), async (c) => {
  const tenant = c.get('tenant')
  const { id } = c.req.param()
  const body = getValidated<typeof createBudgetSchema>(c, 'json')!

  const [updated] = await db
    .update(departmentBudgets)
    .set({
      ...body,
      allocatedBudget: body.allocatedBudget ? String(body.allocatedBudget) : undefined,
      updatedAt: new Date(),
    })
    .where(and(eq(departmentBudgets.id, id), eq(departmentBudgets.tenantId, tenant.tenantId)))
    .returning()

  if (!updated) return c.json({ error: 'Budget not found' }, 404)

  return c.json({ budget: updated })
})

// Delete budget
departmentBudgetsRouter.delete('/:id', async (c) => {
  const tenant = c.get('tenant')
  const { id } = c.req.param()

  const [deleted] = await db
    .delete(departmentBudgets)
    .where(and(eq(departmentBudgets.id, id), eq(departmentBudgets.tenantId, tenant.tenantId)))
    .returning()

  if (!deleted) return c.json({ error: 'Budget not found' }, 404)

  return c.json({ message: 'Budget deleted' })
})

export default departmentBudgetsRouter
