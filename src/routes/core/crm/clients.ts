import { Hono } from 'hono'
import { z } from 'zod'
import { eq, and, or, ilike } from 'drizzle-orm'
import { db } from '../../../db'
import { clients } from '../../../db/schema'
import { authMiddleware, type Variables as AuthVariables } from '../../../middleware/auth'
import { requireModuleAccess } from '../../../middleware/rbac'
import { tenantMiddleware, type TenantVariables } from '../../../middleware/tenant'

type Variables = AuthVariables & TenantVariables

const clientsRouter = new Hono<{ Variables: Variables }>()

clientsRouter.use('*', authMiddleware)
clientsRouter.use('*', tenantMiddleware)
clientsRouter.use('*', requireModuleAccess('crm:read', 'crm:write'))

const createClientSchema = z.object({
  name: z.string().min(1).max(255),
  type: z.enum(['corporate', 'individual']).default('corporate'),
  industry: z.string().max(100).optional(),
  website: z.string().url().optional(),
  logoUrl: z.string().url().optional(),
  picName: z.string().max(255).optional(),
  picEmail: z.string().email().optional(),
  picPhone: z.string().max(20).optional(),
  picPosition: z.string().max(100).optional(),
  status: z.enum(['lead', 'prospect', 'active', 'churned', 'inactive']).default('lead'),
  source: z.string().max(100).optional(),
  assignedTo: z.string().uuid().optional(),
  taxId: z.string().max(50).optional(),
  address: z.string().optional(),
  billingEmail: z.string().email().optional(),
})

clientsRouter.get('/', async (c) => {
  const tenant = c.get('tenant')
  const { search, status } = c.req.query()

  let data

  if (search) {
    data = await db.query.clients.findMany({
      where: and(
        eq(clients.tenantId, tenant.tenantId),
        or(
          ilike(clients.name, `%${search}%`),
          ilike(clients.picName, `%${search}%`),
          ilike(clients.picEmail, `%${search}%`)
        )
      ),
      orderBy: (clients, { desc }) => [desc(clients.createdAt)],
    })
  } else if (status) {
    data = await db.query.clients.findMany({
      where: and(
        eq(clients.tenantId, tenant.tenantId),
        eq(clients.status, status)
      ),
      orderBy: (clients, { desc }) => [desc(clients.createdAt)],
    })
  } else {
    data = await db.query.clients.findMany({
      where: eq(clients.tenantId, tenant.tenantId),
      orderBy: (clients, { desc }) => [desc(clients.createdAt)],
    })
  }

  return c.json({ clients: data, total: data.length })
})

clientsRouter.get('/stats', async (c) => {
  const tenant = c.get('tenant')

  const allClients = await db.query.clients.findMany({
    where: eq(clients.tenantId, tenant.tenantId),
    columns: { status: true },
  })

  const stats = {
    total: allClients.length,
    lead: allClients.filter((c) => c.status === 'lead').length,
    prospect: allClients.filter((c) => c.status === 'prospect').length,
    active: allClients.filter((c) => c.status === 'active').length,
    churned: allClients.filter((c) => c.status === 'churned').length,
    inactive: allClients.filter((c) => c.status === 'inactive').length,
  }

  return c.json({ stats })
})

clientsRouter.get('/:id', async (c) => {
  const tenant = c.get('tenant')
  const { id } = c.req.param()
  const client = await db.query.clients.findFirst({
    where: and(eq(clients.id, id), eq(clients.tenantId, tenant.tenantId)),
  })

  if (!client) {
    return c.json({ error: 'Client not found' }, 404)
  }

  return c.json({ client })
})

clientsRouter.post('/', async (c) => {
  const tenant = c.get('tenant')
  const body = createClientSchema.parse(await c.req.json())

  const [client] = await db.insert(clients).values({
    ...body,
    tenantId: tenant.tenantId,
  }).returning()

  return c.json({ client }, 201)
})

clientsRouter.patch('/:id', async (c) => {
  const tenant = c.get('tenant')
  const { id } = c.req.param()
  const body = createClientSchema.partial().parse(await c.req.json())

  const [updated] = await db
    .update(clients)
    .set({ ...body, updatedAt: new Date() })
    .where(and(eq(clients.id, id), eq(clients.tenantId, tenant.tenantId)))
    .returning()

  if (!updated) {
    return c.json({ error: 'Client not found' }, 404)
  }

  return c.json({ client: updated })
})

clientsRouter.patch('/:id/status', async (c) => {
  const tenant = c.get('tenant')
  const { id } = c.req.param()
  const { status } = await c.req.json()

  const validStatuses = ['lead', 'prospect', 'active', 'churned', 'inactive']
  if (!validStatuses.includes(status)) {
    return c.json({ error: 'Invalid status' }, 400)
  }

  const [updated] = await db
    .update(clients)
    .set({ status, updatedAt: new Date() })
    .where(and(eq(clients.id, id), eq(clients.tenantId, tenant.tenantId)))
    .returning()

  if (!updated) {
    return c.json({ error: 'Client not found' }, 404)
  }

  return c.json({ client: updated })
})

clientsRouter.delete('/:id', async (c) => {
  const tenant = c.get('tenant')
  const { id } = c.req.param()

  // Soft delete
  const [deleted] = await db
    .update(clients)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(clients.id, id), eq(clients.tenantId, tenant.tenantId)))
    .returning()

  if (!deleted) {
    return c.json({ error: 'Client not found' }, 404)
  }

  return c.json({ message: 'Client deleted' })
})

export default clientsRouter
