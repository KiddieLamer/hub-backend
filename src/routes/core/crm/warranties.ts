import { Hono } from 'hono'
import { z } from 'zod'
import { eq, and, SQL, ilike } from 'drizzle-orm'
import { db } from '../../../db'
import { warrantiesInsurances, warrantyClaims } from '../../../db/schema'
import { authMiddleware, type Variables as AuthVariables } from '../../../middleware/auth'
import { tenantMiddleware, type TenantVariables } from '../../../middleware/tenant'

type Variables = AuthVariables & TenantVariables

const warrantiesRouter = new Hono<{ Variables: Variables }>()
warrantiesRouter.use('*', authMiddleware)
warrantiesRouter.use('*', tenantMiddleware)

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

  const conditions: SQL[] = [eq(warrantiesInsurances.tenantId, tenant.tenantId)]

  if (search) conditions.push(ilike(warrantiesInsurances.policyNumber, `%${search}%`))
  if (status) conditions.push(eq(warrantiesInsurances.status, status))
  if (type) conditions.push(eq(warrantiesInsurances.type, type))
  if (clientId) conditions.push(eq(warrantiesInsurances.clientId, clientId))

  const data = await db.query.warrantiesInsurances.findMany({
    where: and(...conditions),
    orderBy: (fields, { desc }) => [desc(fields.createdAt)],
  })

  return c.json({ warranties: data, total: data.length })
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
  const body = createWarrantySchema.parse(await c.req.json())

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
  const body = createWarrantySchema.partial().parse(await c.req.json())

  const [updated] = await db
    .update(warrantiesInsurances)
    .set({ ...body, updatedAt: new Date() })
    .where(and(eq(warrantiesInsurances.id, id), eq(warrantiesInsurances.tenantId, tenant.tenantId)))
    .returning()

  if (!updated) return c.json({ error: 'Warranty not found' }, 404)

  return c.json({ warranty: updated })
})

// Update warranty status
warrantiesRouter.post('/:id/status', async (c) => {
  const tenant = c.get('tenant')
  const { id } = c.req.param()
  const { status } = await c.req.json()

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
  const body = createClaimSchema.parse(await c.req.json())

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
warrantiesRouter.post('/claims/:id/status', async (c) => {
  const tenant = c.get('tenant')
  const { id } = c.req.param()
  const { status, resolutionNotes } = await c.req.json()

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
