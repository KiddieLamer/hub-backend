import { Hono } from 'hono'
import { authMiddleware, type Variables } from '../../middleware/auth'
import { z } from 'zod'

const notifications = new Hono<{ Variables: Variables }>()
notifications.use('*', authMiddleware)

interface Notification {
  id: string
  userId: string
  title: string
  message: string
  type: string
  read: boolean
  createdAt: string
}

const store = new Map<string, Notification[]>()
let counter = 0

function getNotifications(userId: string): Notification[] {
  return store.get(userId) || []
}

function addNotification(userId: string, title: string, message: string, type: string): Notification {
  const notif: Notification = {
    id: `n-${++counter}`,
    userId,
    title,
    message,
    type,
    read: false,
    createdAt: new Date().toISOString(),
  }
  const existing = store.get(userId) || []
  existing.unshift(notif)
  store.set(userId, existing)
  return notif
}

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
})

notifications.get('/', async (c) => {
  const user = c.get('user')
  const notifications = getNotifications(user.id)
  return c.json({ notifications })
})

notifications.patch('/:id/read', async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')
  const userNotifs = store.get(user.id) || []
  const notif = userNotifs.find(n => n.id === id)
  if (notif) {
    notif.read = true
  }
  return c.json({ message: 'Marked as read' })
})

notifications.post('/email', async (c) => {
  const body = emailSchema.parse(await c.req.json())
  console.log(`[Notification] Email to: ${body.to}, subject: ${body.subject}`)
  return c.json({ message: 'Email queued', to: body.to, subject: body.subject })
})

notifications.post('/whatsapp', async (c) => {
  const body = whatsappSchema.parse(await c.req.json())
  console.log(`[Notification] WhatsApp to: ${body.to}`)
  return c.json({ message: 'WhatsApp queued', to: body.to })
})

notifications.post('/push', async (c) => {
  const body = pushSchema.parse(await c.req.json())
  addNotification(body.userId, body.title, body.body || '', 'push')
  console.log(`[Notification] Push to user: ${body.userId}`)
  return c.json({ message: 'Push notification queued', userId: body.userId, title: body.title })
})

export { addNotification }
export default notifications
