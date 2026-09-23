import { Hono } from 'hono'
import { z } from 'zod'
import { eq, and, SQL, ilike } from 'drizzle-orm'
import { db } from '../../../db'
import { catalogItems } from '../../../db/schema'
import { authMiddleware, type Variables as AuthVariables } from '../../../middleware/auth'
import { requireModuleAccess } from '../../../middleware/rbac'
import { tenantMiddleware, type TenantVariables } from '../../../middleware/tenant'

type Variables = AuthVariables & TenantVariables

const catalogItemsRouter = new Hono<{ Variables: Variables }>()
catalogItemsRouter.use('*', authMiddleware)
catalogItemsRouter.use('*', tenantMiddleware)
catalogItemsRouter.use('*', requireModuleAccess('catalog:read', 'catalog:write'))

const createItemSchema = z.object({
  itemCode: z.string().min(1).max(100),
  name: z.string().min(1).max(255),
  type: z.enum(['item', 'service', 'booking', 'subscription', 'rental', 'digital_good', 'bundle']),
  categoryId: z.string().uuid().optional(),
  description: z.string().optional(),
  price: z.number().min(0),
  costPrice: z.number().min(0).default(0),
  unit: z.string().max(50).default('pcs'),
  isTrackInventory: z.boolean().default(false),
  stockQuantity: z.number().min(0).default(0),
  status: z.enum(['active', 'archived']).default('active'),
})

// List items
catalogItemsRouter.get('/', async (c) => {
  const tenant = c.get('tenant')
  const { search, type, category, status } = c.req.query()

  const conditions: SQL[] = [eq(catalogItems.tenantId, tenant.tenantId)]

  if (search) conditions.push(ilike(catalogItems.name, `%${search}%`))
  if (type) conditions.push(eq(catalogItems.type, type))
  if (category) conditions.push(eq(catalogItems.categoryId, category))
  if (status) conditions.push(eq(catalogItems.status, status))

  const data = await db.query.catalogItems.findMany({
    where: and(...conditions),
    orderBy: (fields, { asc }) => [asc(fields.name)],
  })

  return c.json({ items: data, total: data.length })
})

// Get item detail
catalogItemsRouter.get('/:id', async (c) => {
  const tenant = c.get('tenant')
  const { id } = c.req.param()

  const item = await db.query.catalogItems.findFirst({
    where: and(eq(catalogItems.id, id), eq(catalogItems.tenantId, tenant.tenantId)),
  })

  if (!item) return c.json({ error: 'Item not found' }, 404)

  return c.json({ item })
})

// Create item
catalogItemsRouter.post('/', async (c) => {
  const tenant = c.get('tenant')
  const body = createItemSchema.parse(await c.req.json())

  const [item] = await db.insert(catalogItems).values({
    ...body,
    tenantId: tenant.tenantId,
    price: String(body.price),
    costPrice: String(body.costPrice),
  }).returning()

  return c.json({ item }, 201)
})

// Update item
catalogItemsRouter.patch('/:id', async (c) => {
  const tenant = c.get('tenant')
  const { id } = c.req.param()
  const body = createItemSchema.partial().parse(await c.req.json())

  const [updated] = await db
    .update(catalogItems)
    .set({
      ...body,
      price: body.price ? String(body.price) : undefined,
      costPrice: body.costPrice ? String(body.costPrice) : undefined,
      updatedAt: new Date(),
    })
    .where(and(eq(catalogItems.id, id), eq(catalogItems.tenantId, tenant.tenantId)))
    .returning()

  if (!updated) return c.json({ error: 'Item not found' }, 404)

  return c.json({ item: updated })
})

// Update stock
catalogItemsRouter.post('/:id/stock', async (c) => {
  const tenant = c.get('tenant')
  const { id } = c.req.param()
  const { quantity, action } = await c.req.json()

  const item = await db.query.catalogItems.findFirst({
    where: and(eq(catalogItems.id, id), eq(catalogItems.tenantId, tenant.tenantId)),
  })

  if (!item) return c.json({ error: 'Item not found' }, 404)
  if (!item.isTrackInventory) return c.json({ error: 'Item does not track inventory' }, 400)

  const currentStock = item.stockQuantity
  const newStock = action === 'add' ? currentStock + quantity : currentStock - quantity

  if (newStock < 0) return c.json({ error: 'Insufficient stock' }, 400)

  const [updated] = await db
    .update(catalogItems)
    .set({ stockQuantity: newStock, updatedAt: new Date() })
    .where(eq(catalogItems.id, id))
    .returning()

  return c.json({ item: updated })
})

// Delete item
catalogItemsRouter.delete('/:id', async (c) => {
  const tenant = c.get('tenant')
  const { id } = c.req.param()

  const [deleted] = await db
    .delete(catalogItems)
    .where(and(eq(catalogItems.id, id), eq(catalogItems.tenantId, tenant.tenantId)))
    .returning()

  if (!deleted) return c.json({ error: 'Item not found' }, 404)

  return c.json({ message: 'Item deleted' })
})

export default catalogItemsRouter
