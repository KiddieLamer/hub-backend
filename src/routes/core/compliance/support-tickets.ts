import { Hono } from 'hono'
import { z } from 'zod'
import { eq, and, SQL, ilike } from 'drizzle-orm'
import { db } from '../../../db'
import { supportTickets } from '../../../db/schema'
import { authMiddleware, type Variables as AuthVariables } from '../../../middleware/auth'
import { tenantMiddleware, type TenantVariables } from '../../../middleware/tenant'

type Variables = AuthVariables & TenantVariables

const supportTicketsRouter = new Hono<{ Variables: Variables }>()
supportTicketsRouter.use('*', authMiddleware)
supportTicketsRouter.use('*', tenantMiddleware)

const ticketStatusSchema = z.object({
  status: z.enum(['open', 'in_progress', 'resolved', 'closed']),
})

const assignTicketSchema = z.object({
  userId: z.string().uuid(),
})

const createTicketSchema = z.object({
  ticketNumber: z.string().min(1).max(100),
  clientId: z.string().uuid().optional(),
  assignedTo: z.string().uuid().optional(),
  category: z.enum(['bug', 'complaint', 'feature_request', 'billing_issue']),
  priority: z.enum(['low', 'medium', 'high', 'critical']).default('medium'),
  subject: z.string().min(1).max(255),
  description: z.string().min(1),
  slaDueDate: z.string().optional(),
})

// List tickets
supportTicketsRouter.get('/', async (c) => {
  const tenant = c.get('tenant')
  const { search, status, category, priority, assignedTo } = c.req.query()

  const conditions: SQL[] = [eq(supportTickets.tenantId, tenant.tenantId)]

  if (search) conditions.push(ilike(supportTickets.subject, `%${search}%`))
  if (status) conditions.push(eq(supportTickets.status, status))
  if (category) conditions.push(eq(supportTickets.category, category))
  if (priority) conditions.push(eq(supportTickets.priority, priority))
  if (assignedTo) conditions.push(eq(supportTickets.assignedTo, assignedTo))

  const data = await db.query.supportTickets.findMany({
    where: and(...conditions),
    orderBy: (fields, { desc }) => [desc(fields.createdAt)],
  })

  return c.json({ tickets: data, total: data.length })
})

// Ticket stats
supportTicketsRouter.get('/stats', async (c) => {
  const tenant = c.get('tenant')

  const all = await db.query.supportTickets.findMany({
    where: eq(supportTickets.tenantId, tenant.tenantId),
    columns: { status: true, priority: true, category: true },
  })

  const stats = {
    total: all.length,
    open: all.filter((t) => t.status === 'open').length,
    inProgress: all.filter((t) => t.status === 'in_progress').length,
    resolved: all.filter((t) => t.status === 'resolved').length,
    closed: all.filter((t) => t.status === 'closed').length,
    byPriority: {
      low: all.filter((t) => t.priority === 'low').length,
      medium: all.filter((t) => t.priority === 'medium').length,
      high: all.filter((t) => t.priority === 'high').length,
      critical: all.filter((t) => t.priority === 'critical').length,
    },
  }

  return c.json({ stats })
})

// Get ticket detail
supportTicketsRouter.get('/:id', async (c) => {
  const tenant = c.get('tenant')
  const { id } = c.req.param()

  const ticket = await db.query.supportTickets.findFirst({
    where: and(eq(supportTickets.id, id), eq(supportTickets.tenantId, tenant.tenantId)),
  })

  if (!ticket) return c.json({ error: 'Ticket not found' }, 404)

  return c.json({ ticket })
})

// Create ticket
supportTicketsRouter.post('/', async (c) => {
  const tenant = c.get('tenant')
  const authUser = c.get('user')
  const body = createTicketSchema.parse(await c.req.json())

  const [ticket] = await db.insert(supportTickets).values({
    ...body,
    tenantId: tenant.tenantId,
    reportedBy: authUser.id,
    slaDueDate: body.slaDueDate ? new Date(body.slaDueDate) : null,
  }).returning()

  return c.json({ ticket }, 201)
})

// Update ticket
supportTicketsRouter.patch('/:id', async (c) => {
  const tenant = c.get('tenant')
  const { id } = c.req.param()
  const body = createTicketSchema.partial().parse(await c.req.json())

  const [updated] = await db
    .update(supportTickets)
    .set({
      ...body,
      slaDueDate: body.slaDueDate ? new Date(body.slaDueDate) : undefined,
      updatedAt: new Date(),
    })
    .where(and(eq(supportTickets.id, id), eq(supportTickets.tenantId, tenant.tenantId)))
    .returning()

  if (!updated) return c.json({ error: 'Ticket not found' }, 404)

  return c.json({ ticket: updated })
})

// Update ticket status
supportTicketsRouter.post('/:id/status', async (c) => {
  const tenant = c.get('tenant')
  const { id } = c.req.param()
  const { status } = ticketStatusSchema.parse(await c.req.json())

  const updateData: Record<string, unknown> = { status, updatedAt: new Date() }

  if (status === 'resolved') {
    updateData.resolvedAt = new Date()
  }

  const [updated] = await db
    .update(supportTickets)
    .set(updateData)
    .where(and(eq(supportTickets.id, id), eq(supportTickets.tenantId, tenant.tenantId)))
    .returning()

  if (!updated) return c.json({ error: 'Ticket not found' }, 404)

  return c.json({ ticket: updated })
})

// Assign ticket
supportTicketsRouter.post('/:id/assign', async (c) => {
  const tenant = c.get('tenant')
  const { id } = c.req.param()
  const { userId } = assignTicketSchema.parse(await c.req.json())

  const [updated] = await db
    .update(supportTickets)
    .set({ assignedTo: userId, updatedAt: new Date() })
    .where(and(eq(supportTickets.id, id), eq(supportTickets.tenantId, tenant.tenantId)))
    .returning()

  if (!updated) return c.json({ error: 'Ticket not found' }, 404)

  return c.json({ ticket: updated })
})

// Delete ticket
supportTicketsRouter.delete('/:id', async (c) => {
  const tenant = c.get('tenant')
  const { id } = c.req.param()

  const [deleted] = await db
    .delete(supportTickets)
    .where(and(eq(supportTickets.id, id), eq(supportTickets.tenantId, tenant.tenantId)))
    .returning()

  if (!deleted) return c.json({ error: 'Ticket not found' }, 404)

  return c.json({ message: 'Ticket deleted' })
})

export default supportTicketsRouter
