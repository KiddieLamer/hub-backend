import { Hono } from 'hono'
import { z } from 'zod'
import { eq, and, SQL, ilike, count } from 'drizzle-orm'
import { db } from '../../db'
import { assets, assetLogs, assetMaintenances } from '../../db/schema'
import { authMiddleware, type Variables as AuthVariables } from '../../middleware/auth'
import { requireModuleAccess } from '../../middleware/rbac'
import { tenantMiddleware, type TenantVariables } from '../../middleware/tenant'
import { parsePagination, paginated } from '../../lib/pagination'
import { validate, getValidated } from '../../middleware/validate'

type Variables = AuthVariables & TenantVariables

const assetsRouter = new Hono<{ Variables: Variables }>()
assetsRouter.use('*', authMiddleware)
assetsRouter.use('*', tenantMiddleware)
assetsRouter.use('*', requireModuleAccess('assets:read', 'assets:write'))

const createAssetSchema = z.object({
  assetCode: z.string().min(1).max(100),
  serialNumber: z.string().max(100).optional(),
  name: z.string().min(1).max(255),
  category: z.string().min(1).max(100),
  brandModel: z.string().max(100).optional(),
  photoUrl: z.string().url().optional(),
  qrCodeUrl: z.string().url().optional(),
  assignedTo: z.string().uuid().optional(),
  department: z.string().max(100).optional(),
  location: z.string().min(1).max(150),
  status: z.enum(['available', 'in_use', 'under_maintenance', 'broken', 'disposed', 'lost']).default('available'),
  condition: z.enum(['new', 'good', 'fair', 'damaged']).default('good'),
  purchaseDate: z.string().optional(),
  purchaseCost: z.number().min(0).optional(),
  supplierVendor: z.string().max(255).optional(),
  warrantyExpiryDate: z.string().optional(),
  depreciationUsefulLifeMonths: z.number().min(0).optional(),
})

const handoverSchema = z.object({
  newUserId: z.string().uuid(),
  notes: z.string().optional(),
})

const maintenanceSchema = z.object({
  maintenanceDate: z.string(),
  cost: z.number().min(0).default(0),
  vendorName: z.string().max(255).optional(),
  description: z.string().min(1),
})

// List assets
const listAssetsQuerySchema = z.object({
  search: z.string().optional(),
  status: z.enum(['available', 'in_use', 'under_maintenance', 'broken', 'disposed', 'lost']).optional(),
  category: z.string().max(100).optional(),
})

assetsRouter.get('/', validate(listAssetsQuerySchema, 'query'), async (c) => {
  const tenant = c.get('tenant')
  const { search, status, category } = getValidated<typeof listAssetsQuerySchema>(c, 'query')!

  const conditions: SQL[] = [eq(assets.tenantId, tenant.tenantId)]

  if (search) {
    conditions.push(ilike(assets.name, `%${search}%`))
  }
  if (status) {
    conditions.push(eq(assets.status, status))
  }
  if (category) {
    conditions.push(eq(assets.category, category))
  }

  const pagination = parsePagination(c)

  const [data, [{ value: total }]] = await Promise.all([
    db.query.assets.findMany({
      where: and(...conditions),
      orderBy: (fields, { desc }) => [desc(fields.createdAt)],
      limit: pagination.limit,
      offset: pagination.offset,
    }),
    db.select({ value: count() }).from(assets).where(and(...conditions)),
  ])

  return c.json(paginated('assets', data, Number(total), pagination))
})

// Asset stats
assetsRouter.get('/stats', async (c) => {
  const tenant = c.get('tenant')

  const allAssets = await db.query.assets.findMany({
    where: eq(assets.tenantId, tenant.tenantId),
    columns: { status: true, condition: true },
  })

  const stats = {
    total: allAssets.length,
    available: allAssets.filter((a) => a.status === 'available').length,
    inUse: allAssets.filter((a) => a.status === 'in_use').length,
    underMaintenance: allAssets.filter((a) => a.status === 'under_maintenance').length,
    broken: allAssets.filter((a) => a.status === 'broken').length,
    disposed: allAssets.filter((a) => a.status === 'disposed').length,
    lost: allAssets.filter((a) => a.status === 'lost').length,
  }

  return c.json({ stats })
})

// Get asset detail
const idParamSchema = z.object({ id: z.string().uuid() })

assetsRouter.get('/:id', validate(idParamSchema, 'param'), async (c) => {
  const tenant = c.get('tenant')
  const { id } = getValidated<typeof idParamSchema>(c, 'param')!

  const asset = await db.query.assets.findFirst({
    where: and(eq(assets.id, id), eq(assets.tenantId, tenant.tenantId)),
  })

  if (!asset) {
    return c.json({ error: 'Asset not found' }, 404)
  }

  // Get asset logs
  const logs = await db.query.assetLogs.findMany({
    where: eq(assetLogs.assetId, id),
    orderBy: (fields, { desc }) => [desc(fields.actionDate)],
  })

  // Get asset maintenances
  const maintenances = await db.query.assetMaintenances.findMany({
    where: eq(assetMaintenances.assetId, id),
    orderBy: (fields, { desc }) => [desc(fields.maintenanceDate)],
  })

  return c.json({ asset, logs, maintenances })
})

// Create asset
assetsRouter.post('/', validate(createAssetSchema, 'json'), async (c) => {
  const tenant = c.get('tenant')
  const body = getValidated<typeof createAssetSchema>(c, 'json')!

  const [asset] = await db.insert(assets).values({
    ...body,
    tenantId: tenant.tenantId,
    purchaseCost: body.purchaseCost ? String(body.purchaseCost) : null,
  }).returning()

  return c.json({ asset }, 201)
})

// Update asset
assetsRouter.patch('/:id', validate(idParamSchema, 'param'), validate(createAssetSchema.partial(), 'json'), async (c) => {
  const tenant = c.get('tenant')
  const { id } = getValidated<typeof idParamSchema>(c, 'param')!
  const body = getValidated<typeof createAssetSchema>(c, 'json')!

  const [updated] = await db
    .update(assets)
    .set({
      ...body,
      purchaseCost: body.purchaseCost ? String(body.purchaseCost) : undefined,
      updatedAt: new Date(),
    })
    .where(and(eq(assets.id, id), eq(assets.tenantId, tenant.tenantId)))
    .returning()

  if (!updated) {
    return c.json({ error: 'Asset not found' }, 404)
  }

  return c.json({ asset: updated })
})

// Handover asset
assetsRouter.post('/:id/handover', validate(idParamSchema, 'param'), validate(handoverSchema, 'json'), async (c) => {
  const tenant = c.get('tenant')
  const { id } = getValidated<typeof idParamSchema>(c, 'param')!
  const body = getValidated<typeof handoverSchema>(c, 'json')!

  const asset = await db.query.assets.findFirst({
    where: and(eq(assets.id, id), eq(assets.tenantId, tenant.tenantId)),
  })

  if (!asset) {
    return c.json({ error: 'Asset not found' }, 404)
  }

  // Create log
  await db.insert(assetLogs).values({
    assetId: id,
    previousUserId: asset.assignedTo,
    newUserId: body.newUserId,
    action: 'handover',
    notes: body.notes,
  })

  // Update asset
  const [updated] = await db
    .update(assets)
    .set({
      assignedTo: body.newUserId,
      status: 'in_use',
      assignedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(and(eq(assets.id, id), eq(assets.tenantId, tenant.tenantId)))
    .returning()

  return c.json({ asset: updated })
})

// Return asset
assetsRouter.post('/:id/return', validate(idParamSchema, 'param'), async (c) => {
  const tenant = c.get('tenant')
  const { id } = getValidated<typeof idParamSchema>(c, 'param')!

  const asset = await db.query.assets.findFirst({
    where: and(eq(assets.id, id), eq(assets.tenantId, tenant.tenantId)),
  })

  if (!asset) {
    return c.json({ error: 'Asset not found' }, 404)
  }

  // Create log
  await db.insert(assetLogs).values({
    assetId: id,
    previousUserId: asset.assignedTo,
    newUserId: null,
    action: 'return',
    notes: 'Asset returned',
  })

  // Update asset
  const [updated] = await db
    .update(assets)
    .set({
      assignedTo: null,
      status: 'available',
      assignedAt: null,
      updatedAt: new Date(),
    })
    .where(and(eq(assets.id, id), eq(assets.tenantId, tenant.tenantId)))
    .returning()

  return c.json({ asset: updated })
})

// Report maintenance
assetsRouter.post('/:id/maintenance', validate(idParamSchema, 'param'), validate(maintenanceSchema, 'json'), async (c) => {
  const tenant = c.get('tenant')
  const { id } = getValidated<typeof idParamSchema>(c, 'param')!
  const body = getValidated<typeof maintenanceSchema>(c, 'json')!

  const asset = await db.query.assets.findFirst({
    where: and(eq(assets.id, id), eq(assets.tenantId, tenant.tenantId)),
  })

  if (!asset) {
    return c.json({ error: 'Asset not found' }, 404)
  }

  const [maintenance] = await db.insert(assetMaintenances).values({
    assetId: id,
    maintenanceDate: body.maintenanceDate,
    cost: String(body.cost),
    vendorName: body.vendorName,
    description: body.description,
  }).returning()

  // Update asset status
  await db
    .update(assets)
    .set({ status: 'under_maintenance', updatedAt: new Date() })
    .where(eq(assets.id, id))

  return c.json({ maintenance }, 201)
})

// Get maintenance history
assetsRouter.get('/:id/maintenances', validate(idParamSchema, 'param'), async (c) => {
  const tenant = c.get('tenant')
  const { id } = getValidated<typeof idParamSchema>(c, 'param')!

  const asset = await db.query.assets.findFirst({
    where: and(eq(assets.id, id), eq(assets.tenantId, tenant.tenantId)),
  })

  if (!asset) {
    return c.json({ error: 'Asset not found' }, 404)
  }

  const maintenances = await db.query.assetMaintenances.findMany({
    where: eq(assetMaintenances.assetId, id),
    orderBy: (fields, { desc }) => [desc(fields.maintenanceDate)],
  })

  return c.json({ maintenances })
})

// Get asset logs
assetsRouter.get('/:id/logs', validate(idParamSchema, 'param'), async (c) => {
  const tenant = c.get('tenant')
  const { id } = getValidated<typeof idParamSchema>(c, 'param')!

  const asset = await db.query.assets.findFirst({
    where: and(eq(assets.id, id), eq(assets.tenantId, tenant.tenantId)),
  })

  if (!asset) {
    return c.json({ error: 'Asset not found' }, 404)
  }

  const logs = await db.query.assetLogs.findMany({
    where: eq(assetLogs.assetId, id),
    orderBy: (fields, { desc }) => [desc(fields.actionDate)],
  })

  return c.json({ logs })
})

// Delete asset (soft delete)
assetsRouter.delete('/:id', validate(idParamSchema, 'param'), async (c) => {
  const tenant = c.get('tenant')
  const { id } = getValidated<typeof idParamSchema>(c, 'param')!

  const [deleted] = await db
    .update(assets)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(assets.id, id), eq(assets.tenantId, tenant.tenantId)))
    .returning()

  if (!deleted) {
    return c.json({ error: 'Asset not found' }, 404)
  }

  return c.json({ message: 'Asset deleted' })
})

export default assetsRouter
