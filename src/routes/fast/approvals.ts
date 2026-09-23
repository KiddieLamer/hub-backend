import { Hono } from 'hono'
import { eq, and } from 'drizzle-orm'
import { db } from '../../db'
import { leaveRequests, overtimeRequests, users } from '../../db/schema'
import { authMiddleware, type Variables as AuthVariables } from '../../middleware/auth'
import { tenantMiddleware, type TenantVariables } from '../../middleware/tenant'
import { resolveApprovalChain } from '../../lib/approvals'

type Variables = AuthVariables & TenantVariables

const approvalsRouter = new Hono<{ Variables: Variables }>()

approvalsRouter.use('*', authMiddleware)
approvalsRouter.use('*', tenantMiddleware)

// Items waiting for the caller's approval (RACI queue).
// Round 1: leaves + overtime. Expense/quotation/PR/PO follow.
approvalsRouter.get('/pending', async (c) => {
  const tenant = c.get('tenant')
  const authUser = c.get('user')
  const isHubAdmin = authUser.platformRole === 'hub-admin'

  const pendingLeaves = await db
    .select({
      id: leaveRequests.id,
      userId: leaveRequests.userId,
      userFullName: users.fullName,
      title: leaveRequests.reason,
      detail: leaveRequests.totalDays,
      createdAt: leaveRequests.createdAt,
    })
    .from(leaveRequests)
    .innerJoin(users, eq(leaveRequests.userId, users.id))
    .where(and(eq(leaveRequests.tenantId, tenant.tenantId), eq(leaveRequests.status, 'pending')))

  const pendingOvertime = await db
    .select({
      id: overtimeRequests.id,
      userId: overtimeRequests.userId,
      userFullName: users.fullName,
      title: overtimeRequests.overtimeDate,
      detail: overtimeRequests.totalHours,
      createdAt: overtimeRequests.createdAt,
    })
    .from(overtimeRequests)
    .innerJoin(users, eq(overtimeRequests.userId, users.id))
    .where(and(eq(overtimeRequests.tenantId, tenant.tenantId), eq(overtimeRequests.status, 'pending')))

  const items: {
    kind: 'leave' | 'overtime'
    id: string
    requesterId: string
    requesterName: string | null
    title: string
    detail: string
    createdAt: Date
    approvers: { userId: string; fullName: string | null; positionName: string | null }[]
  }[] = []

  for (const r of pendingLeaves) {
    const chain = await resolveApprovalChain(tenant.tenantId, r.userId)
    if (!isHubAdmin && !chain.some((a) => a.userId === authUser.id)) continue
    if (!isHubAdmin && r.userId === authUser.id && chain.length > 0) continue
    items.push({
      kind: 'leave',
      id: r.id,
      requesterId: r.userId,
      requesterName: r.userFullName,
      title: r.title,
      detail: `${r.detail} hari`,
      createdAt: r.createdAt,
      approvers: chain.map((a) => ({ userId: a.userId, fullName: a.fullName, positionName: a.positionName })),
    })
  }

  for (const r of pendingOvertime) {
    const chain = await resolveApprovalChain(tenant.tenantId, r.userId)
    if (!isHubAdmin && !chain.some((a) => a.userId === authUser.id)) continue
    if (!isHubAdmin && r.userId === authUser.id && chain.length > 0) continue
    items.push({
      kind: 'overtime',
      id: r.id,
      requesterId: r.userId,
      requesterName: r.userFullName,
      title: `Lembur ${r.title}`,
      detail: `${r.detail} jam`,
      createdAt: r.createdAt,
      approvers: chain.map((a) => ({ userId: a.userId, fullName: a.fullName, positionName: a.positionName })),
    })
  }

  items.sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt))

  return c.json({ items, total: items.length })
})

export default approvalsRouter
