import { Hono } from 'hono'
import { z } from 'zod'
import { eq, and, or, ilike, isNull, count, asc, desc, type SQL } from 'drizzle-orm'
import { db } from '../../../db'
import { clients, clientActivities, clientInsights, clientTasks, clientWarranties, users } from '../../../db/schema'
import { authMiddleware, type Variables as AuthVariables } from '../../../middleware/auth'
import { requireModuleAccess } from '../../../middleware/rbac'
import { tenantMiddleware, type TenantVariables } from '../../../middleware/tenant'
import { parsePagination, paginated } from '../../../lib/pagination'
import { validate, getValidated } from '../../../middleware/validate'

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
  mobile: z.string().max(20).optional(),
  topic: z.string().max(255).optional(),
  rating: z.string().max(20).optional(),
  budget: z.string().max(50).optional(),
  identityType: z.string().max(20).optional(),
  identityNumber: z.string().max(50).optional(),
  tags: z.array(z.string().max(50)).optional(),
  socialMedia: z
    .object({
      instagram: z.string().max(100).optional(),
      linkedin: z.string().max(100).optional(),
      twitter: z.string().max(100).optional(),
    })
    .optional(),
})

const updateClientSchema = createClientSchema.partial()

const updateClientStatusSchema = z.object({
  status: z.enum(['lead', 'prospect', 'active', 'churned', 'inactive']),
})

// ============ SUB-RESOURCE: PROFILE CRM (activities / tasks / warranty) ============

const clientActivitySchema = z.object({
  type: z.enum(['note', 'call', 'email', 'meeting']).default('note'),
  content: z.string().min(1).max(5000),
})

const clientTaskSchema = z.object({
  title: z.string().min(1).max(255),
  description: z.string().max(2000).optional(),
  dueDate: z.string().max(100).optional(),
  type: z.enum(['call', 'email', 'meeting', 'task']).default('task'),
})

const updateClientTaskSchema = z.object({
  title: z.string().min(1).max(255).optional(),
  description: z.string().max(2000).optional(),
  dueDate: z.string().max(100).optional(),
  type: z.enum(['call', 'email', 'meeting', 'task']).optional(),
  isCompleted: z.boolean().optional(),
})

const clientWarrantySchema = z.object({
  productName: z.string().min(1).max(255),
  serialNumber: z.string().max(100).optional(),
  startDate: z.string().date().optional(),
  endDate: z.string().date().optional(),
  coverageType: z.string().max(255).optional(),
  status: z.enum(['Active', 'Expiring Soon', 'Expired']).default('Active'),
})

// Client harus milik tenant yang sedang aktif (isolasi per-company).
async function getOwnedClient(tenantId: string, clientId: string) {
  return db.query.clients.findFirst({
    where: and(
      eq(clients.id, clientId),
      eq(clients.tenantId, tenantId),
      isNull(clients.deletedAt)
    ),
  })
}

clientsRouter.get('/', async (c) => {
  const tenant = c.get('tenant')
  const { search, status } = c.req.query()
  const { page, limit, offset } = parsePagination(c)

  const conditions: SQL[] = [
    eq(clients.tenantId, tenant.tenantId),
    isNull(clients.deletedAt),
  ]

  if (search) {
    conditions.push(
      or(
        ilike(clients.name, `%${search}%`),
        ilike(clients.picName, `%${search}%`),
        ilike(clients.picEmail, `%${search}%`)
      )!
    )
  }
  if (status) conditions.push(eq(clients.status, status))

  const where = and(...conditions)

  const [data, totalRows] = await Promise.all([
    db.query.clients.findMany({
      where,
      orderBy: (fields, { desc }) => [desc(fields.createdAt)],
      limit,
      offset,
    }),
    db.select({ total: count() }).from(clients).where(where),
  ])

  return c.json(paginated('clients', data, totalRows[0]?.total ?? 0, { page, limit, offset }))
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
    where: and(eq(clients.id, id), eq(clients.tenantId, tenant.tenantId), isNull(clients.deletedAt)),
  })

  if (!client) {
    return c.json({ error: 'Client not found' }, 404)
  }

  return c.json({ client })
})

clientsRouter.post('/', validate(createClientSchema, 'json'), async (c) => {
  const tenant = c.get('tenant')
  const body = getValidated<typeof createClientSchema>(c, 'json')!

  const [client] = await db.insert(clients).values({
    ...body,
    tenantId: tenant.tenantId,
  }).returning()

  return c.json({ client }, 201)
})

clientsRouter.patch('/:id', validate(updateClientSchema, 'json'), async (c) => {
  const tenant = c.get('tenant')
  const { id } = c.req.param()
  const body = getValidated<typeof updateClientSchema>(c, 'json')!

  const [updated] = await db
    .update(clients)
    .set({ ...body, updatedAt: new Date() })
    .where(and(eq(clients.id, id), eq(clients.tenantId, tenant.tenantId), isNull(clients.deletedAt)))
    .returning()

  if (!updated) {
    return c.json({ error: 'Client not found' }, 404)
  }

  return c.json({ client: updated })
})

clientsRouter.patch('/:id/status', validate(updateClientStatusSchema, 'json'), async (c) => {
  const tenant = c.get('tenant')
  const { id } = c.req.param()
  const { status } = getValidated<typeof updateClientStatusSchema>(c, 'json')!

  const [updated] = await db
    .update(clients)
    .set({ status, updatedAt: new Date() })
    .where(and(eq(clients.id, id), eq(clients.tenantId, tenant.tenantId), isNull(clients.deletedAt)))
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
    .where(and(eq(clients.id, id), eq(clients.tenantId, tenant.tenantId), isNull(clients.deletedAt)))
    .returning()

  if (!deleted) {
    return c.json({ error: 'Client not found' }, 404)
  }

  return c.json({ message: 'Client deleted' })
})

// ============ ACTIVITIES ============

clientsRouter.get('/:clientId/activities', async (c) => {
  const tenant = c.get('tenant')
  const { clientId } = c.req.param()

  const client = await getOwnedClient(tenant.tenantId, clientId)
  if (!client) return c.json({ error: 'Client not found' }, 404)

  const rows = await db
    .select({
      id: clientActivities.id,
      type: clientActivities.type,
      content: clientActivities.content,
      createdAt: clientActivities.createdAt,
      authorId: clientActivities.authorId,
      authorName: users.fullName,
      authorAvatar: users.avatarUrl,
    })
    .from(clientActivities)
    .leftJoin(users, eq(users.id, clientActivities.authorId))
    .where(
      and(
        eq(clientActivities.clientId, clientId),
        eq(clientActivities.tenantId, tenant.tenantId)
      )
    )
    .orderBy(desc(clientActivities.createdAt))

  return c.json({ activities: rows })
})

clientsRouter.post('/:clientId/activities', validate(clientActivitySchema, 'json'), async (c) => {
  const tenant = c.get('tenant')
  const user = c.get('user')
  const { clientId } = c.req.param()
  const body = getValidated<typeof clientActivitySchema>(c, 'json')!

  const client = await getOwnedClient(tenant.tenantId, clientId)
  if (!client) return c.json({ error: 'Client not found' }, 404)

  const [activity] = await db
    .insert(clientActivities)
    .values({
      clientId,
      tenantId: tenant.tenantId,
      type: body.type,
      content: body.content,
      authorId: user.id,
    })
    .returning()

  const [withAuthor] = await db
    .select({
      id: clientActivities.id,
      type: clientActivities.type,
      content: clientActivities.content,
      createdAt: clientActivities.createdAt,
      authorId: clientActivities.authorId,
      authorName: users.fullName,
      authorAvatar: users.avatarUrl,
    })
    .from(clientActivities)
    .leftJoin(users, eq(users.id, clientActivities.authorId))
    .where(eq(clientActivities.id, activity.id))

  return c.json({ activity: withAuthor }, 201)
})

clientsRouter.delete('/:clientId/activities/:id', async (c) => {
  const tenant = c.get('tenant')
  const { clientId, id } = c.req.param()

  const client = await getOwnedClient(tenant.tenantId, clientId)
  if (!client) return c.json({ error: 'Client not found' }, 404)

  const [deleted] = await db
    .delete(clientActivities)
    .where(
      and(
        eq(clientActivities.id, id),
        eq(clientActivities.clientId, clientId),
        eq(clientActivities.tenantId, tenant.tenantId)
      )
    )
    .returning()

  if (!deleted) return c.json({ error: 'Activity not found' }, 404)

  return c.json({ message: 'Activity deleted' })
})

// ============ TASKS ============

clientsRouter.get('/:clientId/tasks', async (c) => {
  const tenant = c.get('tenant')
  const { clientId } = c.req.param()

  const client = await getOwnedClient(tenant.tenantId, clientId)
  if (!client) return c.json({ error: 'Client not found' }, 404)

  const rows = await db
    .select()
    .from(clientTasks)
    .where(
      and(
        eq(clientTasks.clientId, clientId),
        eq(clientTasks.tenantId, tenant.tenantId)
      )
    )
    .orderBy(asc(clientTasks.createdAt))

  return c.json({ tasks: rows })
})

clientsRouter.post('/:clientId/tasks', validate(clientTaskSchema, 'json'), async (c) => {
  const tenant = c.get('tenant')
  const { clientId } = c.req.param()
  const body = getValidated<typeof clientTaskSchema>(c, 'json')!

  const client = await getOwnedClient(tenant.tenantId, clientId)
  if (!client) return c.json({ error: 'Client not found' }, 404)

  const [task] = await db
    .insert(clientTasks)
    .values({
      clientId,
      tenantId: tenant.tenantId,
      title: body.title,
      description: body.description,
      dueDate: body.dueDate,
      type: body.type,
    })
    .returning()

  return c.json({ task }, 201)
})

clientsRouter.patch('/:clientId/tasks/:id', validate(updateClientTaskSchema, 'json'), async (c) => {
  const tenant = c.get('tenant')
  const { clientId, id } = c.req.param()
  const body = getValidated<typeof updateClientTaskSchema>(c, 'json')!

  const client = await getOwnedClient(tenant.tenantId, clientId)
  if (!client) return c.json({ error: 'Client not found' }, 404)

  const [updated] = await db
    .update(clientTasks)
    .set({ ...body, updatedAt: new Date() })
    .where(
      and(
        eq(clientTasks.id, id),
        eq(clientTasks.clientId, clientId),
        eq(clientTasks.tenantId, tenant.tenantId)
      )
    )
    .returning()

  if (!updated) return c.json({ error: 'Task not found' }, 404)

  return c.json({ task: updated })
})

clientsRouter.delete('/:clientId/tasks/:id', async (c) => {
  const tenant = c.get('tenant')
  const { clientId, id } = c.req.param()

  const client = await getOwnedClient(tenant.tenantId, clientId)
  if (!client) return c.json({ error: 'Client not found' }, 404)

  const [deleted] = await db
    .delete(clientTasks)
    .where(
      and(
        eq(clientTasks.id, id),
        eq(clientTasks.clientId, clientId),
        eq(clientTasks.tenantId, tenant.tenantId)
      )
    )
    .returning()

  if (!deleted) return c.json({ error: 'Task not found' }, 404)

  return c.json({ message: 'Task deleted' })
})

// ============ INSIGHTS ============

const clientInsightSchema = z.object({
  text: z.string().min(1).max(500),
  subtext: z.string().max(2000).optional(),
  sortOrder: z.number().int().min(0).max(1000).optional(),
})

const clientInsightsBulkSchema = z.object({
  insights: z.array(clientInsightSchema).max(50),
})

clientsRouter.get('/:clientId/insights', async (c) => {
  const tenant = c.get('tenant')
  const { clientId } = c.req.param()

  const client = await getOwnedClient(tenant.tenantId, clientId)
  if (!client) return c.json({ error: 'Client not found' }, 404)

  const rows = await db.query.clientInsights.findMany({
    where: and(
      eq(clientInsights.clientId, clientId),
      eq(clientInsights.tenantId, tenant.tenantId)
    ),
    orderBy: (fields, { asc }) => [asc(fields.sortOrder), asc(fields.createdAt)],
  })

  return c.json({ insights: rows })
})

clientsRouter.post('/:clientId/insights', validate(clientInsightSchema, 'json'), async (c) => {
  const tenant = c.get('tenant')
  const { clientId } = c.req.param()
  const body = getValidated<typeof clientInsightSchema>(c, 'json')!

  const client = await getOwnedClient(tenant.tenantId, clientId)
  if (!client) return c.json({ error: 'Client not found' }, 404)

  const [insight] = await db
    .insert(clientInsights)
    .values({
      clientId,
      tenantId: tenant.tenantId,
      text: body.text,
      subtext: body.subtext,
      sortOrder: body.sortOrder ?? 0,
    })
    .returning()

  return c.json({ insight }, 201)
})

clientsRouter.delete('/:clientId/insights/:id', async (c) => {
  const tenant = c.get('tenant')
  const { clientId, id } = c.req.param()

  const client = await getOwnedClient(tenant.tenantId, clientId)
  if (!client) return c.json({ error: 'Client not found' }, 404)

  const [deleted] = await db
    .delete(clientInsights)
    .where(
      and(
        eq(clientInsights.id, id),
        eq(clientInsights.clientId, clientId),
        eq(clientInsights.tenantId, tenant.tenantId)
      )
    )
    .returning()

  if (!deleted) return c.json({ error: 'Insight not found' }, 404)

  return c.json({ message: 'Insight deleted' })
})

// Replace-all semantics: hapus semua insight client ini lalu insert ulang dari body.
clientsRouter.put('/:clientId/insights', validate(clientInsightsBulkSchema, 'json'), async (c) => {
  const tenant = c.get('tenant')
  const { clientId } = c.req.param()
  const body = getValidated<typeof clientInsightsBulkSchema>(c, 'json')!

  const client = await getOwnedClient(tenant.tenantId, clientId)
  if (!client) return c.json({ error: 'Client not found' }, 404)

  await db
    .delete(clientInsights)
    .where(
      and(
        eq(clientInsights.clientId, clientId),
        eq(clientInsights.tenantId, tenant.tenantId)
      )
    )

  if (body.insights.length > 0) {
    await db.insert(clientInsights).values(
      body.insights.map((row, i) => ({
        clientId,
        tenantId: tenant.tenantId,
        text: row.text,
        subtext: row.subtext,
        sortOrder: row.sortOrder ?? i,
      }))
    )
  }

  const rows = await db.query.clientInsights.findMany({
    where: and(
      eq(clientInsights.clientId, clientId),
      eq(clientInsights.tenantId, tenant.tenantId)
    ),
    orderBy: (fields, { asc }) => [asc(fields.sortOrder), asc(fields.createdAt)],
  })

  return c.json({ insights: rows })
})

// ============ WARRANTY ============

clientsRouter.get('/:clientId/warranty', async (c) => {
  const tenant = c.get('tenant')
  const { clientId } = c.req.param()

  const client = await getOwnedClient(tenant.tenantId, clientId)
  if (!client) return c.json({ error: 'Client not found' }, 404)

  const warranty = await db.query.clientWarranties.findFirst({
    where: and(
      eq(clientWarranties.clientId, clientId),
      eq(clientWarranties.tenantId, tenant.tenantId)
    ),
  })

  return c.json({ warranty: warranty ?? null })
})

clientsRouter.put('/:clientId/warranty', validate(clientWarrantySchema, 'json'), async (c) => {
  const tenant = c.get('tenant')
  const { clientId } = c.req.param()
  const body = getValidated<typeof clientWarrantySchema>(c, 'json')!

  const client = await getOwnedClient(tenant.tenantId, clientId)
  if (!client) return c.json({ error: 'Client not found' }, 404)

  const [warranty] = await db
    .insert(clientWarranties)
    .values({
      clientId,
      tenantId: tenant.tenantId,
      ...body,
    })
    .onConflictDoUpdate({
      target: clientWarranties.clientId,
      set: { ...body, updatedAt: new Date() },
    })
    .returning()

  return c.json({ warranty })
})

export default clientsRouter
