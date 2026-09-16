import { Hono } from 'hono'
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { db } from '../../db'
import { shifts } from '../../db/schema'
import { authMiddleware, type Variables as AuthVariables } from '../../middleware/auth'
import { tenantMiddleware, type TenantVariables } from '../../middleware/tenant'

type Variables = AuthVariables & TenantVariables

const shiftsRouter = new Hono<{ Variables: Variables }>()
shiftsRouter.use('*', authMiddleware)
shiftsRouter.use('*', tenantMiddleware)

const createShiftSchema = z.object({
  name: z.string().min(1).max(100),
  clockInTime: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),
  clockOutTime: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),
  lateGracePeriodMins: z.number().min(0).max(120).default(15),
})

shiftsRouter.get('/', async (c) => {
  const tenant = c.get('tenant')
  const data = await db.query.shifts.findMany({
    where: eq(shifts.tenantId, tenant.tenantId),
    orderBy: (fields, { asc }) => [asc(fields.name)],
  })
  return c.json({ shifts: data })
})

shiftsRouter.post('/', async (c) => {
  const tenant = c.get('tenant')
  const body = createShiftSchema.parse(await c.req.json())

  const [shift] = await db.insert(shifts).values({
    ...body,
    tenantId: tenant.tenantId,
  }).returning()

  return c.json({ shift }, 201)
})

shiftsRouter.patch('/:id', async (c) => {
  const { id } = c.req.param()
  const body = createShiftSchema.partial().parse(await c.req.json())

  const [updated] = await db
    .update(shifts)
    .set({ ...body, updatedAt: new Date() })
    .where(eq(shifts.id, id))
    .returning()

  if (!updated) {
    return c.json({ error: 'Shift not found' }, 404)
  }

  return c.json({ shift: updated })
})

shiftsRouter.delete('/:id', async (c) => {
  const { id } = c.req.param()

  const [deleted] = await db
    .delete(shifts)
    .where(eq(shifts.id, id))
    .returning()

  if (!deleted) {
    return c.json({ error: 'Shift not found' }, 404)
  }

  return c.json({ message: 'Shift deleted' })
})

export default shiftsRouter
