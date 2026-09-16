import { Hono } from 'hono'
import { z } from 'zod'
import { eq, and, SQL, inArray } from 'drizzle-orm'
import { db } from '../../../db'
import { stockMovements, catalogItems } from '../../../db/schema'
import { authMiddleware, type Variables as AuthVariables } from '../../../middleware/auth'
import { tenantMiddleware, type TenantVariables } from '../../../middleware/tenant'

type Variables = AuthVariables & TenantVariables

const stockMovementsRouter = new Hono<{ Variables: Variables }>()
stockMovementsRouter.use('*', authMiddleware)
stockMovementsRouter.use('*', tenantMiddleware)

const adjustSchema = z.object({
  itemId: z.string().uuid(),
  quantity: z.number(),
  type: z.enum(['in', 'out']),
  notes: z.string().optional(),
})

const projectUseSchema = z.object({
  itemId: z.string().uuid(),
  quantity: z.number(),
  projectId: z.string().uuid(),
  notes: z.string().optional(),
})

// List stock movements
stockMovementsRouter.get('/', async (c) => {
  const tenant = c.get('tenant')
  const { catalogItemId, movementType, projectId } = c.req.query()

  const tenantCatalogItemIds = db.select({ id: catalogItems.id }).from(catalogItems).where(eq(catalogItems.tenantId, tenant.tenantId))
  const conditions: SQL[] = [inArray(stockMovements.catalogItemId, tenantCatalogItemIds)]

  if (catalogItemId) conditions.push(eq(stockMovements.catalogItemId, catalogItemId))
  if (movementType) conditions.push(eq(stockMovements.movementType, movementType))
  if (projectId) conditions.push(eq(stockMovements.referenceProjectId, projectId))

  const data = await db.query.stockMovements.findMany({
    where: and(...conditions),
    orderBy: (fields, { desc }) => [desc(fields.createdAt)],
    limit: 100,
  })

  return c.json({ movements: data, total: data.length })
})

// Get stock summary
stockMovementsRouter.get('/summary', async (c) => {
  const tenant = c.get('tenant')

  const items = await db.query.catalogItems.findMany({
    where: and(eq(catalogItems.isTrackInventory, true), eq(catalogItems.tenantId, tenant.tenantId)),
    orderBy: (fields, { asc }) => [asc(fields.name)],
  })

  const summary = items.map((item) => ({
    id: item.id,
    itemCode: item.itemCode,
    name: item.name,
    stockQuantity: item.stockQuantity,
    unit: item.unit,
  }))

  return c.json({ summary })
})

// Manual stock adjustment
stockMovementsRouter.post('/adjust', async (c) => {
  const tenant = c.get('tenant')
  const authUser = c.get('user')
  const { itemId, quantity, notes } = adjustSchema.parse(await c.req.json())

  const item = await db.query.catalogItems.findFirst({
    where: and(eq(catalogItems.id, itemId), eq(catalogItems.tenantId, tenant.tenantId)),
  })

  if (!item) return c.json({ error: 'Item not found' }, 404)
  if (!item.isTrackInventory) return c.json({ error: 'Item does not track inventory' }, 400)

  const stockBefore = item.stockQuantity
  const stockAfter = stockBefore + quantity

  if (stockAfter < 0) return c.json({ error: 'Insufficient stock' }, 400)

  await db.insert(stockMovements).values({
    catalogItemId: itemId,
    movementType: 'adjustment_opname',
    quantity,
    stockBefore,
    stockAfter,
    performedBy: authUser.id,
    notes,
  })

  await db
    .update(catalogItems)
    .set({ stockQuantity: stockAfter, updatedAt: new Date() })
    .where(and(eq(catalogItems.id, itemId), eq(catalogItems.tenantId, tenant.tenantId)))

  return c.json({ stockBefore, stockAfter })
})

// Project usage (out stock)
stockMovementsRouter.post('/project-use', async (c) => {
  const tenant = c.get('tenant')
  const authUser = c.get('user')
  const { itemId, projectId, quantity, notes } = projectUseSchema.parse(await c.req.json())

  const item = await db.query.catalogItems.findFirst({
    where: and(eq(catalogItems.id, itemId), eq(catalogItems.tenantId, tenant.tenantId)),
  })

  if (!item) return c.json({ error: 'Item not found' }, 404)
  if (!item.isTrackInventory) return c.json({ error: 'Item does not track inventory' }, 400)

  const stockBefore = item.stockQuantity
  const stockAfter = stockBefore - quantity

  if (stockAfter < 0) return c.json({ error: 'Insufficient stock' }, 400)

  await db.insert(stockMovements).values({
    catalogItemId: itemId,
    movementType: 'out_project',
    quantity: -quantity,
    stockBefore,
    stockAfter,
    referenceProjectId: projectId,
    performedBy: authUser.id,
    notes,
  })

  await db
    .update(catalogItems)
    .set({ stockQuantity: stockAfter, updatedAt: new Date() })
    .where(and(eq(catalogItems.id, itemId), eq(catalogItems.tenantId, tenant.tenantId)))

  return c.json({ stockBefore, stockAfter })
})

export default stockMovementsRouter
