import { Hono } from 'hono'
import { z } from 'zod'
import { eq, and } from 'drizzle-orm'
import { db } from '../../../db'
import { catalogCategories } from '../../../db/schema'
import { authMiddleware, type Variables as AuthVariables } from '../../../middleware/auth'
import { tenantMiddleware, type TenantVariables } from '../../../middleware/tenant'

type Variables = AuthVariables & TenantVariables

const catalogCategoriesRouter = new Hono<{ Variables: Variables }>()
catalogCategoriesRouter.use('*', authMiddleware)
catalogCategoriesRouter.use('*', tenantMiddleware)

const createCategorySchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().optional(),
})

// List categories
catalogCategoriesRouter.get('/', async (c) => {
  const tenant = c.get('tenant')

  const data = await db.query.catalogCategories.findMany({
    where: eq(catalogCategories.tenantId, tenant.tenantId),
    orderBy: (fields, { asc }) => [asc(fields.name)],
  })

  return c.json({ categories: data, total: data.length })
})

// Get category detail
catalogCategoriesRouter.get('/:id', async (c) => {
  const tenant = c.get('tenant')
  const { id } = c.req.param()

  const category = await db.query.catalogCategories.findFirst({
    where: and(eq(catalogCategories.id, id), eq(catalogCategories.tenantId, tenant.tenantId)),
  })

  if (!category) return c.json({ error: 'Category not found' }, 404)

  return c.json({ category })
})

// Create category
catalogCategoriesRouter.post('/', async (c) => {
  const tenant = c.get('tenant')
  const body = createCategorySchema.parse(await c.req.json())

  const [category] = await db.insert(catalogCategories).values({
    ...body,
    tenantId: tenant.tenantId,
  }).returning()

  return c.json({ category }, 201)
})

// Update category
catalogCategoriesRouter.patch('/:id', async (c) => {
  const tenant = c.get('tenant')
  const { id } = c.req.param()
  const body = createCategorySchema.partial().parse(await c.req.json())

  const [updated] = await db
    .update(catalogCategories)
    .set({ ...body, updatedAt: new Date() })
    .where(and(eq(catalogCategories.id, id), eq(catalogCategories.tenantId, tenant.tenantId)))
    .returning()

  if (!updated) return c.json({ error: 'Category not found' }, 404)

  return c.json({ category: updated })
})

// Delete category
catalogCategoriesRouter.delete('/:id', async (c) => {
  const tenant = c.get('tenant')
  const { id } = c.req.param()

  const [deleted] = await db
    .delete(catalogCategories)
    .where(and(eq(catalogCategories.id, id), eq(catalogCategories.tenantId, tenant.tenantId)))
    .returning()

  if (!deleted) return c.json({ error: 'Category not found' }, 404)

  return c.json({ message: 'Category deleted' })
})

export default catalogCategoriesRouter
