import { Hono } from 'hono'
import { z } from 'zod'
import { eq, and, count } from 'drizzle-orm'
import { db } from '../../../db'
import { expenseCategories } from '../../../db/schema'
import { authMiddleware, type Variables as AuthVariables } from '../../../middleware/auth'
import { requireModuleAccess } from '../../../middleware/rbac'
import { tenantMiddleware, type TenantVariables } from '../../../middleware/tenant'
import { parsePagination, paginated } from '../../../lib/pagination'
import { validate, getValidated } from '../../../middleware/validate'

type Variables = AuthVariables & TenantVariables

const expenseCategoriesRouter = new Hono<{ Variables: Variables }>()
expenseCategoriesRouter.use('*', authMiddleware)
expenseCategoriesRouter.use('*', tenantMiddleware)
expenseCategoriesRouter.use('*', requireModuleAccess('finance:read', 'finance:write'))

const createCategorySchema = z.object({
  name: z.string().min(1).max(100),
  code: z.string().max(50).optional(),
  description: z.string().optional(),
  isActive: z.boolean().default(true),
})

// List categories
expenseCategoriesRouter.get('/', async (c) => {
  const tenant = c.get('tenant')
  const pagination = parsePagination(c)
  const where = eq(expenseCategories.tenantId, tenant.tenantId)

  const [data, [{ value: total }]] = await Promise.all([
    db.query.expenseCategories.findMany({
      where,
      orderBy: (fields, { asc }) => [asc(fields.name)],
      limit: pagination.limit,
      offset: pagination.offset,
    }),
    db.select({ value: count() }).from(expenseCategories).where(where),
  ])

  return c.json(paginated('categories', data, Number(total), pagination))
})

// Get category detail
expenseCategoriesRouter.get('/:id', async (c) => {
  const tenant = c.get('tenant')
  const { id } = c.req.param()

  const category = await db.query.expenseCategories.findFirst({
    where: and(eq(expenseCategories.id, id), eq(expenseCategories.tenantId, tenant.tenantId)),
  })

  if (!category) return c.json({ error: 'Category not found' }, 404)

  return c.json({ category })
})

// Create category
expenseCategoriesRouter.post('/', async (c) => {
  const tenant = c.get('tenant')
  const body = getValidated<typeof createCategorySchema>(c, 'json')!

  const [category] = await db.insert(expenseCategories).values({
    ...body,
    tenantId: tenant.tenantId,
  }).returning()

  return c.json({ category }, 201)
})

// Update category
expenseCategoriesRouter.patch('/:id', validate(createCategorySchema.partial(), 'json'), async (c) => {
  const tenant = c.get('tenant')
  const { id } = c.req.param()
  const body = getValidated<typeof createCategorySchema>(c, 'json')!

  const [updated] = await db
    .update(expenseCategories)
    .set({ ...body, updatedAt: new Date() })
    .where(and(eq(expenseCategories.id, id), eq(expenseCategories.tenantId, tenant.tenantId)))
    .returning()

  if (!updated) return c.json({ error: 'Category not found' }, 404)

  return c.json({ category: updated })
})

// Delete category
expenseCategoriesRouter.delete('/:id', async (c) => {
  const tenant = c.get('tenant')
  const { id } = c.req.param()

  const [deleted] = await db
    .delete(expenseCategories)
    .where(and(eq(expenseCategories.id, id), eq(expenseCategories.tenantId, tenant.tenantId)))
    .returning()

  if (!deleted) return c.json({ error: 'Category not found' }, 404)

  return c.json({ message: 'Category deleted' })
})

export default expenseCategoriesRouter
