import { Hono } from 'hono'
import { z } from 'zod'
import { eq, and, count } from 'drizzle-orm'
import { db } from '../../db'
import { shifts } from '../../db/schema'
import { authMiddleware, type Variables as AuthVariables } from '../../middleware/auth'
import { requireModuleAccess } from '../../middleware/rbac'
import { tenantMiddleware, type TenantVariables } from '../../middleware/tenant'
import { parsePagination, paginated } from '../../lib/pagination'
import { getValidated } from '../../middleware/validate'

type Variables = AuthVariables & TenantVariables

const shiftsRouter = new Hono<{ Variables: Variables }>()
shiftsRouter.use('*', authMiddleware)
shiftsRouter.use('*', tenantMiddleware)
shiftsRouter.use('*', requireModuleAccess('hris:read', 'hris:write'))

const createShiftSchema = z.object({
  name: z.string().min(1).max(100),
  clockInTime: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),
  clockOutTime: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),
  lateGracePeriodMins: z.number().min(0).max(120).default(15),
})

shiftsRouter.get('/', async (c) => {
  const tenant = c.get('tenant')
  const pagination = parsePagination(c)
  const where = eq(shifts.tenantId, tenant.tenantId)

  const [data, [{ value: total }]] = await Promise.all([
    db.query.shifts.findMany({
      where,
      orderBy: (fields, { asc }) => [asc(fields.name)],
      limit: pagination.limit,
      offset: pagination.offset,
    }),
    db.select({ value: count() }).from(shifts).where(where),
  ])

  return c.json(paginated('shifts', data, Number(total), pagination))
})

shiftsRouter.post('/', async (c) => {
  const tenant = c.get('tenant')
  const body = getValidated<typeof createShiftSchema>(c, 'json')!

  const [shift] = await db.insert(shifts).values({
    ...body,
    tenantId: tenant.tenantId,
  }).returning()

  return c.json({ shift }, 201)
})

shiftsRouter.patch('/:id', async (c) => {
  const tenant = c.get('tenant')
  const { id } = c.req.param()
  const body = getValidated<ReturnType<typeof createShiftSchema.partial>>(c, 'json')!

  // SECURITY: scope the mutation to the caller's tenant, not just the id.
  const [updated] = await db
    .update(shifts)
    .set({ ...body, updatedAt: new Date() })
    .where(and(eq(shifts.id, id), eq(shifts.tenantId, tenant.tenantId)))
    .returning()

  if (!updated) {
    return c.json({ error: 'Shift not found' }, 404)
  }

  return c.json({ shift: updated })
})

shiftsRouter.delete('/:id', async (c) => {
  const tenant = c.get('tenant')
  const { id } = c.req.param()

  // SECURITY: scope the delete to the caller's tenant.
  const [deleted] = await db
    .delete(shifts)
    .where(and(eq(shifts.id, id), eq(shifts.tenantId, tenant.tenantId)))
    .returning()

  if (!deleted) {
    return c.json({ error: 'Shift not found' }, 404)
  }

  return c.json({ message: 'Shift deleted' })
})

export default shiftsRouter
