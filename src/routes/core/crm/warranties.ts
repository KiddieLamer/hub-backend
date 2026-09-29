import { Hono } from 'hono'
import { z } from 'zod'
import { eq, and, SQL, ilike, count } from 'drizzle-orm'
import { db } from '../../../db'
import { warrantiesInsurances, warrantyClaims } from '../../../db/schema'
import { authMiddleware, type Variables as AuthVariables } from '../../../middleware/auth'
import { requireModuleAccess } from '../../../middleware/rbac'
import { tenantMiddleware, type TenantVariables } from '../../../middleware/tenant'
import { parsePagination, paginated } from '../../../lib/pagination'
import { validate, getValidated } from '../../../middleware/validate'

type Variables = AuthVariables & TenantVariables

const warrantiesRouter = new Hono<{ Variables: Variables }>()
warrantiesRouter.use('*', authMiddleware)
warrantiesRouter.use('*', tenantMiddleware)
warrantiesRouter.use('*', requireModuleAccess('crm:read', 'crm:write'))

const createWarrantySchema = z.object({
  policyNumber: z.string().min(1).max(100),
  type: z.enum(['warranty', 'insurance']).default('warranty'),
  clientId: z.string().uuid(),
  catalogItemId: z.string().uuid().optional(),
  projectId: z.string().uuid().optional(),
  invoiceId: z.string().uuid().optional(),
  serialNumberOrAssetId: z.string().max(255).optional(),
  providerName: z.string().max(255).default('Internal Tenant'),
  coverageDetails: z.string().optional(),
  startDate: z.string(),
  endDate: z.string(),
})

const updateWarrantySchema = createWarrantySchema.partial()

const createClaimSchema = z.object({
  claimNumber: z.string().min(1).max(100),
  warrantyId: z.string().uuid(),
  ticketId: z.string().uuid().optional(),
  assignedTo: z.string().uuid().optional(),
  claimDate: z.string(),
  issueDescription: z.string().min(1),
  claimAmount: z.number().min(0).default(0),
})

// List warranties
warrantiesRouter.get('/', async (c) => {
  const tenant = c.get('tenant')
  const { search, status, type, clientId } = c.req.query()
  const pagination = parsePagination(c)

  const conditions: SQL[] = [eq(warrantiesInsurances.tenantId, tenant.tenantId)]

  if (search) conditions.push(ilike(warrantiesInsurances.policyNumber, `%${search}%`))
  if (status) conditions.push(eq(warrantiesInsurances.status, status))
  if (type) conditions.push(eq(warrantiesInsurances.type, type))
  if (clientId) conditions.push(eq(warrantiesInsurances.clientId, clientId))

  const where = and(...conditions)

  const [data, [{ value: total }]] = await Promise.all([
    db.query.warrantiesInsurances.findMany({
      where,
      orderBy: (fields, { desc }) => [desc(fields.createdAt)],
      limit: pagination.limit,
      offset: pagination.offset,
    }),
    db.select({ value: count() }).from(warrantiesInsurances).where(where),
  ])

  return c.json(paginated('warranties', data, Number(total), pagination))
})

// Get warranty detail
warrantiesRouter.get('/:id', async (c) => {
  const tenant = c.get('tenant')
  const { id } = c.req.param()

  const warranty = await db.query.warrantiesInsurances.findFirst({
    where: and(eq(warrantiesInsurances.id, id), eq(warrantiesInsurances.tenantId, tenant.tenantId)),
  })

  if (!warranty) return c.json({ error: 'Warranty not found' }, 404)

  const claims = await db.query.warrantyClaims.findMany({
    where: eq(warrantyClaims.warrantyId, id),
    orderBy: (fields, { desc }) => [desc(fields.claimDate)],
  })

  return c.json({ warranty: { ...warranty, claims } })
})

// Create warranty
warrantiesRouter.post('/', async (c) => {
  const tenant = c.get('tenant')
  const body = getValidated<typeof createWarrantySchema>(c, 'json')!

  const [warranty] = await db.insert(warrantiesInsurances).values({
    ...body,
    tenantId: tenant.tenantId,
  }).returning()

  return c.json({ warranty }, 201)
})

// Update warranty
warrantiesRouter.patch('/:id', async (c) => {
  const tenant = c.get('tenant')
  const { id } = c.req.param()
  const body = getValidated<typeof updateWarrantySchema>(c, 'json')!

  const [updated] = await db
    .update(warrantiesInsurances)
    .set({ ...body, updatedAt: new Date() })
    .where(and(eq(warrantiesInsurances.id, id), eq(warrantiesInsurances.tenantId, tenant.tenantId)))
    .returning()

  if (!updated) return c.json({ error: 'Warranty not found' }, 404)

  return c.json({ warranty: updated })
})

// Update warranty status
const updateWarrantyStatusSchema = z.object({
  status: z.enum(['active', 'claimed', 'expired', 'cancelled']),
})

warrantiesRouter.post('/:id/status', async (c) => {
  const tenant = c.get('tenant')
  const { id } = c.req.param()
  const { status } = getValidated<typeof updateWarrantyStatusSchema>(c, 'json')!

  const [updated] = await db
    .update(warrantiesInsurances)
    .set({ status, updatedAt: new Date() })
    .where(and(eq(warrantiesInsurances.id, id), eq(warrantiesInsurances.tenantId, tenant.tenantId)))
    .returning()

  if (!updated) return c.json({ error: 'Warranty not found' }, 404)

  return c.json({ warranty: updated })
})

// Delete warranty
warrantiesRouter.delete('/:id', async (c) => {
  const tenant = c.get('tenant')
  const { id } = c.req.param()

  const [deleted] = await db
    .delete(warrantiesInsurances)
    .where(and(eq(warrantiesInsurances.id, id), eq(warrantiesInsurances.tenantId, tenant.tenantId)))
    .returning()

  if (!deleted) return c.json({ error: 'Warranty not found' }, 404)

  return c.json({ message: 'Warranty deleted' })
})

// ============ CLAIMS ============

// List claims
warrantiesRouter.get('/claims/list', async (c) => {
  const tenant = c.get('tenant')
  const { status, warrantyId } = c.req.query()

  const conditions: SQL[] = [eq(warrantyClaims.tenantId, tenant.tenantId)]

  if (status) conditions.push(eq(warrantyClaims.status, status))
  if (warrantyId) conditions.push(eq(warrantyClaims.warrantyId, warrantyId))

  const data = await db.query.warrantyClaims.findMany({
    where: and(...conditions),
    orderBy: (fields, { desc }) => [desc(fields.claimDate)],
  })

  return c.json({ claims: data, total: data.length })
})

// Get claim detail
warrantiesRouter.get('/claims/:id', async (c) => {
  const tenant = c.get('tenant')
  const { id } = c.req.param()

  const claim = await db.query.warrantyClaims.findFirst({
    where: and(eq(warrantyClaims.id, id), eq(warrantyClaims.tenantId, tenant.tenantId)),
  })

  if (!claim) return c.json({ error: 'Claim not found' }, 404)

  return c.json({ claim })
})

// Create claim
warrantiesRouter.post('/claims', async (c) => {
  const tenant = c.get('tenant')
  const body = getValidated<typeof createClaimSchema>(c, 'json')!

  const [claim] = await db.insert(warrantyClaims).values({
    ...body,
    tenantId: tenant.tenantId,
    claimAmount: String(body.claimAmount),
  }).returning()

  // Update warranty status to claimed
  await db
    .update(warrantiesInsurances)
    .set({ status: 'claimed', updatedAt: new Date() })
    .where(and(eq(warrantiesInsurances.id, body.warrantyId), eq(warrantiesInsurances.tenantId, tenant.tenantId)))

  return c.json({ claim }, 201)
})

// Update claim status
const updateClaimStatusSchema = z.object({
  status: z.enum(['submitted', 'under_review', 'approved', 'rejected', 'resolved']),
  resolutionNotes: z.string().optional(),
})

warrantiesRouter.post('/claims/:id/status', async (c) => {
  const tenant = c.get('tenant')
  const { id } = c.req.param()
  const { status, resolutionNotes } = getValidated<typeof updateClaimStatusSchema>(c, 'json')!

  const [updated] = await db
    .update(warrantyClaims)
    .set({ status, resolutionNotes, updatedAt: new Date() })
    .where(and(eq(warrantyClaims.id, id), eq(warrantyClaims.tenantId, tenant.tenantId)))
    .returning()

  if (!updated) return c.json({ error: 'Claim not found' }, 404)

  return c.json({ claim: updated })
})

// Delete claim
warrantiesRouter.delete('/claims/:id', async (c) => {
  const tenant = c.get('tenant')
  const { id } = c.req.param()

  const [deleted] = await db.delete(warrantyClaims).where(and(eq(warrantyClaims.id, id), eq(warrantyClaims.tenantId, tenant.tenantId))).returning()

  if (!deleted) return c.json({ error: 'Claim not found' }, 404)

  return c.json({ message: 'Claim deleted' })
})

export default warrantiesRouter
