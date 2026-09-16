import { Hono } from 'hono'
import { z } from 'zod'
import { eq, and } from 'drizzle-orm'
import { db } from '../../../db'
import { expenseCategories } from '../../../db/schema'
import { authMiddleware, type Variables as AuthVariables } from '../../../middleware/auth'
import { tenantMiddleware, type TenantVariables } from '../../../middleware/tenant'

type Variables = AuthVariables & TenantVariables

const expenseCategoriesRouter = new Hono<{ Variables: Variables }>()
expenseCategoriesRouter.use('*', authMiddleware)
expenseCategoriesRouter.use('*', tenantMiddleware)

const createCategorySchema = z.object({
  name: z.string().min(1).max(100),
  code: z.string().max(50).optional(),
  description: z.string().optional(),
  isActive: z.boolean().default(true),
})

// List categories
expenseCategoriesRouter.get('/', async (c) => {
  const tenant = c.get('tenant')

  const data = await db.query.expenseCategories.findMany({
    where: eq(expenseCategories.tenantId, tenant.tenantId),
    orderBy: (fields, { asc }) => [asc(fields.name)],
  })

  return c.json({ categories: data, total: data.length })
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
  const body = createCategorySchema.parse(await c.req.json())

  const [category] = await db.insert(expenseCategories).values({
    ...body,
    tenantId: tenant.tenantId,
  }).returning()

  return c.json({ category }, 201)
})

// Update category
expenseCategoriesRouter.patch('/:id', async (c) => {
  const tenant = c.get('tenant')
  const { id } = c.req.param()
  const body = createCategorySchema.partial().parse(await c.req.json())

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
