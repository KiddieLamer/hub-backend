import { Hono, type Context } from 'hono'
import { z } from 'zod'
import { eq, and } from 'drizzle-orm'
import { db } from '../../../db'
import { leaveTypes, leaveRequests } from '../../../db/schema'
import { authMiddleware, type Variables as AuthVariables } from '../../../middleware/auth'
import { requireModuleAccess } from '../../../middleware/rbac'
import { requireApprover } from '../../../lib/approvals'
import { tenantMiddleware, type TenantVariables } from '../../../middleware/tenant'

type Variables = AuthVariables & TenantVariables

const leavesRouter = new Hono<{ Variables: Variables }>()
leavesRouter.use('*', authMiddleware)
leavesRouter.use('*', tenantMiddleware)
leavesRouter.use('*', requireModuleAccess('hris:read', 'hris:write'))

const leaveTypeSchema = z.object({
  name: z.string().min(1).max(100),
  isPaid: z.boolean().default(true),
  totalQuota: z.number().min(0),
  description: z.string().max(500).optional(),
})

const leaveRequestSchema = z.object({
  leaveTypeId: z.string().uuid(),
  startDate: z.string(),
  endDate: z.string(),
  totalDays: z.number().min(1),
  reason: z.string().min(1),
  attachmentUrl: z.string().url().optional(),
})

// Leave Types
leavesRouter.get('/types', async (c) => {
  const tenant = c.get('tenant')
  const data = await db.query.leaveTypes.findMany({
    where: eq(leaveTypes.tenantId, tenant.tenantId),
  })
  return c.json({ leaveTypes: data })
})

leavesRouter.post('/types', async (c) => {
  const tenant = c.get('tenant')
  const body = leaveTypeSchema.parse(await c.req.json())

  const [leaveType] = await db.insert(leaveTypes).values({
    ...body,
    tenantId: tenant.tenantId,
  }).returning()

  return c.json({ leaveType }, 201)
})

leavesRouter.patch('/types/:id', async (c) => {
  const tenant = c.get('tenant')
  const { id } = c.req.param()
  const body = leaveTypeSchema.partial().parse(await c.req.json())

  const [updated] = await db
    .update(leaveTypes)
    .set({ ...body })
    .where(and(eq(leaveTypes.id, id), eq(leaveTypes.tenantId, tenant.tenantId)))
    .returning()

  if (!updated) {
    return c.json({ error: 'Leave type not found' }, 404)
  }

  return c.json({ leaveType: updated })
})

leavesRouter.delete('/types/:id', async (c) => {
  const tenant = c.get('tenant')
  const { id } = c.req.param()

  const [deleted] = await db
    .delete(leaveTypes)
    .where(and(eq(leaveTypes.id, id), eq(leaveTypes.tenantId, tenant.tenantId)))
    .returning({ id: leaveTypes.id })

  if (!deleted) {
    return c.json({ error: 'Leave type not found' }, 404)
  }

  return c.json({ message: 'Leave type deleted' })
})

// Leave Requests
leavesRouter.get('/requests', async (c) => {
  const tenant = c.get('tenant')
  const authUser = c.get('user')
  const data = await db.query.leaveRequests.findMany({
    where: and(eq(leaveRequests.tenantId, tenant.tenantId), eq(leaveRequests.userId, authUser.id)),
    orderBy: (fields, { desc }) => [desc(fields.createdAt)],
  })
  return c.json({ leaveRequests: data })
})

leavesRouter.post('/requests', async (c) => {
  const tenant = c.get('tenant')
  const authUser = c.get('user')
  const body = leaveRequestSchema.parse(await c.req.json())

  const [request] = await db.insert(leaveRequests).values({
    ...body,
    tenantId: tenant.tenantId,
    userId: authUser.id,
  }).returning()

  return c.json({ leaveRequest: request }, 201)
})

leavesRouter.delete('/requests/:id', async (c) => {
  const tenant = c.get('tenant')
  const { id } = c.req.param()

  const [deleted] = await db
    .delete(leaveRequests)
    .where(and(eq(leaveRequests.id, id), eq(leaveRequests.tenantId, tenant.tenantId)))
    .returning({ id: leaveRequests.id })

  if (!deleted) {
    return c.json({ error: 'Leave request not found' }, 404)
  }

  return c.json({ message: 'Leave request deleted' })
})

async function leaveRequester(c: Context) {
  const tenant = c.get('tenant') as { tenantId: string }
  const { id } = c.req.param()
  const req = await db.query.leaveRequests.findFirst({
    where: and(eq(leaveRequests.id, id), eq(leaveRequests.tenantId, tenant.tenantId)),
    columns: { userId: true },
  })
  return req ? { requesterUserId: req.userId } : null
}

leavesRouter.patch('/requests/:id/approve', requireApprover(leaveRequester), async (c) => {
  const tenant = c.get('tenant')
  const authUser = c.get('user')
  const { id } = c.req.param()

  const [updated] = await db
    .update(leaveRequests)
    .set({
      status: 'approved',
      approvedBy: authUser.id,
      updatedAt: new Date(),
    })
    .where(and(eq(leaveRequests.id, id), eq(leaveRequests.tenantId, tenant.tenantId)))
    .returning()

  if (!updated) {
    return c.json({ error: 'Leave request not found' }, 404)
  }

  return c.json({ leaveRequest: updated })
})

leavesRouter.patch('/requests/:id/reject', requireApprover(leaveRequester), async (c) => {
  const tenant = c.get('tenant')
  const authUser = c.get('user')
  const { id } = c.req.param()

  const [updated] = await db
    .update(leaveRequests)
    .set({
      status: 'rejected',
      approvedBy: authUser.id,
      updatedAt: new Date(),
    })
    .where(and(eq(leaveRequests.id, id), eq(leaveRequests.tenantId, tenant.tenantId)))
    .returning()

  if (!updated) {
    return c.json({ error: 'Leave request not found' }, 404)
  }

  return c.json({ leaveRequest: updated })
})

export default leavesRouter
