import { Hono } from 'hono'
import { z } from 'zod'
import { eq, and, SQL, ilike, count } from 'drizzle-orm'
import { db } from '../../../db'
import { suppliers } from '../../../db/schema'
import { authMiddleware, type Variables as AuthVariables } from '../../../middleware/auth'
import { requireModuleAccess } from '../../../middleware/rbac'
import { tenantMiddleware, type TenantVariables } from '../../../middleware/tenant'
import { parsePagination, paginated } from '../../../lib/pagination'
import { validate, getValidated } from '../../../middleware/validate'

type Variables = AuthVariables & TenantVariables

const suppliersRouter = new Hono<{ Variables: Variables }>()
suppliersRouter.use('*', authMiddleware)
suppliersRouter.use('*', tenantMiddleware)
suppliersRouter.use('*', requireModuleAccess('procurement:read', 'procurement:write'))

const createSupplierSchema = z.object({
  supplierCode: z.string().min(1).max(100),
  companyName: z.string().min(1).max(255),
  contactName: z.string().max(255).optional(),
  phoneNumber: z.string().max(50).optional(),
  email: z.string().email().optional(),
  address: z.string().optional(),
  taxNumber: z.string().max(100).optional(),
  status: z.enum(['active', 'archived']).default('active'),
})

const updateSupplierSchema = createSupplierSchema.partial()

// List suppliers
suppliersRouter.get('/', async (c) => {
  const tenant = c.get('tenant')
  const { search, status } = c.req.query()
  const pagination = parsePagination(c)

  const conditions: SQL[] = [eq(suppliers.tenantId, tenant.tenantId)]

  if (search) conditions.push(ilike(suppliers.companyName, `%${search}%`))
  if (status) conditions.push(eq(suppliers.status, status))

  const where = and(...conditions)

  const [data, [{ value: total }]] = await Promise.all([
    db.query.suppliers.findMany({
      where,
      orderBy: (fields, { asc }) => [asc(fields.companyName)],
      limit: pagination.limit,
      offset: pagination.offset,
    }),
    db.select({ value: count() }).from(suppliers).where(where),
  ])

  return c.json(paginated('suppliers', data, Number(total), pagination))
})

// Get supplier detail
suppliersRouter.get('/:id', async (c) => {
  const tenant = c.get('tenant')
  const { id } = c.req.param()

  const supplier = await db.query.suppliers.findFirst({
    where: and(eq(suppliers.id, id), eq(suppliers.tenantId, tenant.tenantId)),
  })

  if (!supplier) return c.json({ error: 'Supplier not found' }, 404)

  return c.json({ supplier })
})

// Create supplier
suppliersRouter.post('/', async (c) => {
  const tenant = c.get('tenant')
  const body = getValidated<typeof createSupplierSchema>(c, 'json')!

  const [supplier] = await db.insert(suppliers).values({
    ...body,
    tenantId: tenant.tenantId,
  }).returning()

  return c.json({ supplier }, 201)
})

// Update supplier
suppliersRouter.patch('/:id', async (c) => {
  const tenant = c.get('tenant')
  const { id } = c.req.param()
  const body = getValidated<typeof updateSupplierSchema>(c, 'json')!

  const [updated] = await db
    .update(suppliers)
    .set({ ...body, updatedAt: new Date() })
    .where(and(eq(suppliers.id, id), eq(suppliers.tenantId, tenant.tenantId)))
    .returning()

  if (!updated) return c.json({ error: 'Supplier not found' }, 404)

  return c.json({ supplier: updated })
})

// Delete supplier
suppliersRouter.delete('/:id', async (c) => {
  const tenant = c.get('tenant')
  const { id } = c.req.param()

  const [deleted] = await db
    .delete(suppliers)
    .where(and(eq(suppliers.id, id), eq(suppliers.tenantId, tenant.tenantId)))
    .returning()

  if (!deleted) return c.json({ error: 'Supplier not found' }, 404)

  return c.json({ message: 'Supplier deleted' })
})

export default suppliersRouter
