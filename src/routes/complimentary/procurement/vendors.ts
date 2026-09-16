import { Hono } from 'hono'
import { z } from 'zod'
import { eq, and, SQL, ilike } from 'drizzle-orm'
import { db } from '../../../db'
import { vendors } from '../../../db/schema'
import { authMiddleware, type Variables as AuthVariables } from '../../../middleware/auth'
import { tenantMiddleware, type TenantVariables } from '../../../middleware/tenant'

type Variables = AuthVariables & TenantVariables

const vendorsRouter = new Hono<{ Variables: Variables }>()
vendorsRouter.use('*', authMiddleware)
vendorsRouter.use('*', tenantMiddleware)

const createVendorSchema = z.object({
  companyName: z.string().min(1).max(255),
  picName: z.string().max(255).optional(),
  email: z.string().email().optional(),
  phoneNumber: z.string().max(20).optional(),
  taxId: z.string().max(50).optional(),
  address: z.string().optional(),
  bankDetails: z.string().optional(),
  rating: z.number().min(0).max(5).optional(),
})

// List vendors
vendorsRouter.get('/', async (c) => {
  const tenant = c.get('tenant')
  const { search } = c.req.query()

  const conditions: SQL[] = [eq(vendors.tenantId, tenant.tenantId)]

  if (search) conditions.push(ilike(vendors.companyName, `%${search}%`))

  const data = await db.query.vendors.findMany({
    where: and(...conditions),
    orderBy: (fields, { desc }) => [desc(fields.createdAt)],
  })

  return c.json({ vendors: data, total: data.length })
})

// Get vendor detail
vendorsRouter.get('/:id', async (c) => {
  const tenant = c.get('tenant')
  const { id } = c.req.param()

  const vendor = await db.query.vendors.findFirst({
    where: and(eq(vendors.id, id), eq(vendors.tenantId, tenant.tenantId)),
  })

  if (!vendor) return c.json({ error: 'Vendor not found' }, 404)

  return c.json({ vendor })
})

// Create vendor
vendorsRouter.post('/', async (c) => {
  const tenant = c.get('tenant')
  const body = createVendorSchema.parse(await c.req.json())

  const [vendor] = await db.insert(vendors).values({
    ...body,
    tenantId: tenant.tenantId,
    rating: body.rating ? String(body.rating) : null,
  }).returning()

  return c.json({ vendor }, 201)
})

// Update vendor
vendorsRouter.patch('/:id', async (c) => {
  const tenant = c.get('tenant')
  const { id } = c.req.param()
  const body = createVendorSchema.partial().parse(await c.req.json())

  const [updated] = await db
    .update(vendors)
    .set({
      ...body,
      rating: body.rating ? String(body.rating) : undefined,
      updatedAt: new Date(),
    })
    .where(and(eq(vendors.id, id), eq(vendors.tenantId, tenant.tenantId)))
    .returning()

  if (!updated) return c.json({ error: 'Vendor not found' }, 404)

  return c.json({ vendor: updated })
})

// Delete vendor (soft delete)
vendorsRouter.delete('/:id', async (c) => {
  const tenant = c.get('tenant')
  const { id } = c.req.param()

  const [deleted] = await db
    .update(vendors)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(vendors.id, id), eq(vendors.tenantId, tenant.tenantId)))
    .returning()

  if (!deleted) return c.json({ error: 'Vendor not found' }, 404)

  return c.json({ message: 'Vendor deleted' })
})

export default vendorsRouter
