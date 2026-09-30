import { Hono } from 'hono'
import { z } from 'zod'
import { and, desc, eq, isNull } from 'drizzle-orm'
import { authMiddleware, type Variables as AuthVariables } from '../../middleware/auth'
import { tenantMiddleware, type TenantVariables } from '../../middleware/tenant'
import { db } from '../../db'
import { notifications as notificationsTable, users, tenantMembers } from '../../db/schema'
import { parsePagination, paginated } from '../../lib/pagination'
import { getValidated } from '../../middleware/validate'

type Variables = AuthVariables & TenantVariables

const notifications = new Hono<{ Variables: Variables }>()
notifications.use('*', authMiddleware)
// SECURITY: /push must know the caller's tenant so it can refuse to fan out
// notifications to users outside it. Other routes stay self-scoped by userId.
notifications.use('/push', tenantMiddleware)

const emailSchema = z.object({
  to: z.string().email(),
  subject: z.string().min(1),
  body: z.string().optional(),
})

const whatsappSchema = z.object({
  to: z.string().min(1),
  message: z.string().min(1),
})

const pushSchema = z.object({
  userId: z.string().uuid(),
  title: z.string().min(1),
  body: z.string().optional(),
  type: z.string().max(50).optional(),
  tenantId: z.string().uuid().optional(),
})

/**
 * Persist an in-app notification for a user.
 * Used by other modules (approvals, assignments, etc.) to fan out events.
 */
export async function addNotification(input: {
  userId: string
  title: string
  message?: string
  type?: string
  tenantId?: string | null
}): Promise<{ id: string }> {
  const [row] = await db
    .insert(notificationsTable)
    .values({
      userId: input.userId,
      title: input.title,
      message: input.message ?? null,
      type: input.type ?? 'info',
      tenantId: input.tenantId ?? null,
    })
    .returning({ id: notificationsTable.id })
  return row
}

// List the caller's notifications (newest first), paginated.
notifications.get('/', async (c) => {
  const user = c.get('user')
  const pagination = parsePagination(c)
  const { page, limit } = pagination
  const unreadOnly = c.req.query('unread') === 'true'

  const conditions = [eq(notificationsTable.userId, user.id)]
  if (unreadOnly) conditions.push(eq(notificationsTable.read, false))
  const where = and(...conditions)

  const [rows, totalRows] = await Promise.all([
    db
      .select()
      .from(notificationsTable)
      .where(where)
      .orderBy(desc(notificationsTable.createdAt))
      .limit(limit)
      .offset((page - 1) * limit),
    db
      .select({ id: notificationsTable.id })
      .from(notificationsTable)
      .where(where),
  ])

  return c.json(paginated('notifications', rows, totalRows.length, pagination))
})

// Mark a single notification as read (scoped to the caller).
notifications.patch('/:id/read', async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')

  const [updated] = await db
    .update(notificationsTable)
    .set({ read: true, readAt: new Date() })
    .where(and(eq(notificationsTable.id, id), eq(notificationsTable.userId, user.id)))
    .returning({ id: notificationsTable.id })

  if (!updated) {
    return c.json({ error: 'Notification not found' }, 404)
  }

  return c.json({ message: 'Marked as read' })
})

// Mark all of the caller's notifications as read.
notifications.post('/read-all', async (c) => {
  const user = c.get('user')
  await db
    .update(notificationsTable)
    .set({ read: true, readAt: new Date() })
    .where(and(eq(notificationsTable.userId, user.id), eq(notificationsTable.read, false)))
  return c.json({ message: 'All marked as read' })
})

notifications.post('/email', async (c) => {
  const body = getValidated<typeof emailSchema>(c, 'json')!
  console.log(`[Notification] Email to: ${body.to}, subject: ${body.subject}`)
  return c.json({ message: 'Email queued', to: body.to, subject: body.subject })
})

notifications.post('/whatsapp', async (c) => {
  const body = getValidated<typeof whatsappSchema>(c, 'json')!
  console.log(`[Notification] WhatsApp to: ${body.to}`)
  return c.json({ message: 'WhatsApp queued', to: body.to })
})

notifications.post('/push', async (c) => {
  const tenant = c.get('tenant')
  const body = getValidated<typeof pushSchema>(c, 'json')!

  // SECURITY: the target must be an active member of the caller's tenant.
  // Previously userId + tenantId came straight from the body, letting any
  // authenticated user send notifications into another tenant (spoofing +
  // cross-tenant spam). tenantId is now taken from the verified context.
  const membership = await db.query.tenantMembers.findFirst({
    where: and(
      eq(tenantMembers.userId, body.userId),
      eq(tenantMembers.tenantId, tenant.tenantId),
    ),
    columns: { userId: true },
  })
  if (!membership) {
    return c.json({ error: 'User is not a member of this tenant' }, 404)
  }

  const target = await db.query.users.findFirst({
    where: and(eq(users.id, body.userId), isNull(users.deletedAt)),
    columns: { id: true },
  })
  if (!target) {
    return c.json({ error: 'User not found' }, 404)
  }

  const notif = await addNotification({
    userId: body.userId,
    title: body.title,
    message: body.body,
    type: body.type ?? 'push',
    tenantId: tenant.tenantId,
  })

  console.log(`[Notification] Push to user: ${body.userId}`)
  return c.json({ message: 'Push notification queued', ...notif })
})

export default notifications
