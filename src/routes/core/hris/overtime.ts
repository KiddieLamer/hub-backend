import { Hono, type Context } from 'hono'
import { z } from 'zod'
import { eq, and } from 'drizzle-orm'
import { db } from '../../../db'
import { overtimeRequests } from '../../../db/schema'
import { authMiddleware, type Variables as AuthVariables } from '../../../middleware/auth'
import { requireModuleAccess } from '../../../middleware/rbac'
import { requireApprover } from '../../../lib/approvals'
import { tenantMiddleware, type TenantVariables } from '../../../middleware/tenant'

type Variables = AuthVariables & TenantVariables

const overtimeRouter = new Hono<{ Variables: Variables }>()
overtimeRouter.use('*', authMiddleware)
overtimeRouter.use('*', tenantMiddleware)
overtimeRouter.use('*', requireModuleAccess('hris:read', 'hris:write'))

const overtimeSchema = z.object({
  overtimeDate: z.string(),
  startTime: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),
  endTime: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),
  totalHours: z.number().min(0.5).max(24),
  multiplierRate: z.number().min(1).max(4).default(1.5),
})

overtimeRouter.get('/', async (c) => {
  const tenant = c.get('tenant')
  const authUser = c.get('user')
  const data = await db.query.overtimeRequests.findMany({
    where: and(eq(overtimeRequests.tenantId, tenant.tenantId), eq(overtimeRequests.userId, authUser.id)),
    orderBy: (fields, { desc }) => [desc(fields.overtimeDate)],
  })
  return c.json({ overtimeRequests: data })
})

overtimeRouter.post('/', async (c) => {
  const tenant = c.get('tenant')
  const authUser = c.get('user')
  const body = overtimeSchema.parse(await c.req.json())

  const [request] = await db.insert(overtimeRequests).values({
    tenantId: tenant.tenantId,
    userId: authUser.id,
    overtimeDate: body.overtimeDate,
    startTime: body.startTime,
    endTime: body.endTime,
    totalHours: String(body.totalHours),
    multiplierRate: String(body.multiplierRate),
  }).returning()

  return c.json({ overtimeRequest: request }, 201)
})

overtimeRouter.get('/:id', async (c) => {
  const tenant = c.get('tenant')
  const { id } = c.req.param()

  const overtimeRequest = await db.query.overtimeRequests.findFirst({
    where: and(eq(overtimeRequests.id, id), eq(overtimeRequests.tenantId, tenant.tenantId)),
  })

  if (!overtimeRequest) {
    return c.json({ error: 'Overtime request not found' }, 404)
  }

  return c.json({ overtimeRequest })
})

overtimeRouter.patch('/:id', async (c) => {
  const tenant = c.get('tenant')
  const { id } = c.req.param()
  const body = overtimeSchema.partial().parse(await c.req.json())

  const [updated] = await db
    .update(overtimeRequests)
    .set({ ...body, totalHours: body.totalHours ? String(body.totalHours) : undefined, multiplierRate: body.multiplierRate ? String(body.multiplierRate) : undefined, updatedAt: new Date() })
    .where(and(eq(overtimeRequests.id, id), eq(overtimeRequests.tenantId, tenant.tenantId)))
    .returning()

  if (!updated) {
    return c.json({ error: 'Overtime request not found' }, 404)
  }

  return c.json({ overtimeRequest: updated })
})

overtimeRouter.delete('/:id', async (c) => {
  const tenant = c.get('tenant')
  const { id } = c.req.param()

  const [deleted] = await db
    .delete(overtimeRequests)
    .where(and(eq(overtimeRequests.id, id), eq(overtimeRequests.tenantId, tenant.tenantId)))
    .returning({ id: overtimeRequests.id })

  if (!deleted) {
    return c.json({ error: 'Overtime request not found' }, 404)
  }

  return c.json({ message: 'Overtime request deleted' })
})

async function overtimeRequester(c: Context) {
  const tenant = c.get('tenant') as { tenantId: string }
  const { id } = c.req.param()
  const req = await db.query.overtimeRequests.findFirst({
    where: and(eq(overtimeRequests.id, id), eq(overtimeRequests.tenantId, tenant.tenantId)),
    columns: { userId: true },
  })
  return req ? { requesterUserId: req.userId } : null
}

overtimeRouter.patch('/:id/approve', requireApprover(overtimeRequester), async (c) => {
  const tenant = c.get('tenant')
  const authUser = c.get('user')
  const { id } = c.req.param()

  const [updated] = await db
    .update(overtimeRequests)
    .set({
      status: 'approved',
      approvedBy: authUser.id,
      updatedAt: new Date(),
    })
    .where(and(eq(overtimeRequests.id, id), eq(overtimeRequests.tenantId, tenant.tenantId)))
    .returning()

  if (!updated) {
    return c.json({ error: 'Overtime request not found' }, 404)
  }

  return c.json({ overtimeRequest: updated })
})

overtimeRouter.patch('/:id/reject', requireApprover(overtimeRequester), async (c) => {
  const tenant = c.get('tenant')
  const authUser = c.get('user')
  const { id } = c.req.param()

  const [updated] = await db
    .update(overtimeRequests)
    .set({
      status: 'rejected',
      approvedBy: authUser.id,
      updatedAt: new Date(),
    })
    .where(and(eq(overtimeRequests.id, id), eq(overtimeRequests.tenantId, tenant.tenantId)))
    .returning()

  if (!updated) {
    return c.json({ error: 'Overtime request not found' }, 404)
  }

  return c.json({ overtimeRequest: updated })
})

export default overtimeRouter
