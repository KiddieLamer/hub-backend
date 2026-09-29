import { Hono } from 'hono'
import { z } from 'zod'
import { eq, and, count } from 'drizzle-orm'
import { db } from '../../../db'
import { catalogCategories } from '../../../db/schema'
import { authMiddleware, type Variables as AuthVariables } from '../../../middleware/auth'
import { requireModuleAccess } from '../../../middleware/rbac'
import { tenantMiddleware, type TenantVariables } from '../../../middleware/tenant'
import { parsePagination, paginated } from '../../../lib/pagination'
import { validate, getValidated } from '../../../middleware/validate'

type Variables = AuthVariables & TenantVariables

const catalogCategoriesRouter = new Hono<{ Variables: Variables }>()
catalogCategoriesRouter.use('*', authMiddleware)
catalogCategoriesRouter.use('*', tenantMiddleware)
catalogCategoriesRouter.use('*', requireModuleAccess('catalog:read', 'catalog:write'))

const createCategorySchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().optional(),
})

// List categories
catalogCategoriesRouter.get('/', async (c) => {
  const tenant = c.get('tenant')
  const pagination = parsePagination(c)
  const whereClause = eq(catalogCategories.tenantId, tenant.tenantId)

  const [data, [{ value: total }]] = await Promise.all([
    db.query.catalogCategories.findMany({
      where: whereClause,
      orderBy: (fields, { asc }) => [asc(fields.name)],
      limit: pagination.limit,
      offset: pagination.offset,
    }),
    db.select({ value: count() }).from(catalogCategories).where(whereClause),
  ])

  return c.json(paginated('categories', data, Number(total), pagination))
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
  const body = getValidated<typeof createCategorySchema>(c, 'json')!

  const [category] = await db.insert(catalogCategories).values({
    ...body,
    tenantId: tenant.tenantId,
  }).returning()

  return c.json({ category }, 201)
})

// Update category
catalogCategoriesRouter.patch('/:id', validate(createCategorySchema.partial(), 'json'), async (c) => {
  const tenant = c.get('tenant')
  const { id } = c.req.param()
  const body = getValidated<typeof createCategorySchema>(c, 'json')!

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
