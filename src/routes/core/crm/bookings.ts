import { Hono } from 'hono'
import { z } from 'zod'
import { eq, and } from 'drizzle-orm'
import { db } from '../../../db'
import { bookings } from '../../../db/schema'
import { authMiddleware, type Variables as AuthVariables } from '../../../middleware/auth'
import { requireModuleAccess } from '../../../middleware/rbac'
import { tenantMiddleware, type TenantVariables } from '../../../middleware/tenant'

type Variables = AuthVariables & TenantVariables

const bookingsRouter = new Hono<{ Variables: Variables }>()

bookingsRouter.use('*', authMiddleware)
bookingsRouter.use('*', tenantMiddleware)
bookingsRouter.use('*', requireModuleAccess('crm:read', 'crm:write'))

const createBookingSchema = z.object({
  clientId: z.string().uuid(),
  title: z.string().max(255).optional(),
  date: z.string(), // YYYY-MM-DD
  startTime: z.string(), // HH:MM
  endTime: z.string(), // HH:MM
  duration: z.number().min(15).max(480).default(60),
  status: z.enum(['pending', 'confirmed', 'cancelled', 'completed']).default('pending'),
  notes: z.string().max(1000).optional(),
})

bookingsRouter.get('/', async (c) => {
  const tenant = c.get('tenant')
  const data = await db.query.bookings.findMany({
    where: eq(bookings.tenantId, tenant.tenantId),
    orderBy: (bookings, { desc }) => [desc(bookings.date), desc(bookings.startTime)],
  })
  return c.json({ bookings: data })
})

bookingsRouter.get('/:id', async (c) => {
  const tenant = c.get('tenant')
  const { id } = c.req.param()
  const booking = await db.query.bookings.findFirst({
    where: and(eq(bookings.id, id), eq(bookings.tenantId, tenant.tenantId)),
  })

  if (!booking) {
    return c.json({ error: 'Booking not found' }, 404)
  }

  return c.json({ booking })
})

bookingsRouter.post('/', async (c) => {
  const tenant = c.get('tenant')
  const user = c.get('user')
  const body = createBookingSchema.parse(await c.req.json())

  const [booking] = await db.insert(bookings).values({
    ...body,
    tenantId: tenant.tenantId,
    userId: user.id,
  }).returning()

  return c.json({ booking }, 201)
})

bookingsRouter.patch('/:id', async (c) => {
  const tenant = c.get('tenant')
  const { id } = c.req.param()
  const body = createBookingSchema.partial().parse(await c.req.json())

  const [updated] = await db
    .update(bookings)
    .set({ ...body, updatedAt: new Date() })
    .where(and(eq(bookings.id, id), eq(bookings.tenantId, tenant.tenantId)))
    .returning()

  if (!updated) {
    return c.json({ error: 'Booking not found' }, 404)
  }

  return c.json({ booking: updated })
})

bookingsRouter.delete('/:id', async (c) => {
  const tenant = c.get('tenant')
  const { id } = c.req.param()

  const [deleted] = await db
    .delete(bookings)
    .where(and(eq(bookings.id, id), eq(bookings.tenantId, tenant.tenantId)))
    .returning()

  if (!deleted) {
    return c.json({ error: 'Booking not found' }, 404)
  }

  return c.json({ message: 'Booking deleted' })
})

export default bookingsRouter
