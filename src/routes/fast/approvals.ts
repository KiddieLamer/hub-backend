import { Hono } from 'hono'
import { eq, and } from 'drizzle-orm'
import { db } from '../../db'
import { leaveRequests, overtimeRequests, expenseClaims, quotations, purchaseRequests, purchaseOrders, pos, users, tenants } from '../../db/schema'
import { authMiddleware, type Variables as AuthVariables } from '../../middleware/auth'
import { tenantMiddleware, type TenantVariables } from '../../middleware/tenant'
import { resolveApprovalChain, resolveLevelApproverChain, type ChainApprover } from '../../lib/approvals'

type Variables = AuthVariables & TenantVariables

const approvalsRouter = new Hono<{ Variables: Variables }>()

approvalsRouter.use('*', authMiddleware)
approvalsRouter.use('*', tenantMiddleware)

type PendingItem = {
  kind: 'leave' | 'overtime' | 'expense' | 'quotation' | 'pr' | 'po' | 'cpo'
  id: string
  requesterId: string
  requesterName: string | null
  title: string
  detail: string
  createdAt: Date
  approvers: { userId: string; fullName: string | null; positionName: string | null }[]
}

function toApprovers(chain: ChainApprover[]) {
  return chain.map((a) => ({ userId: a.userId, fullName: a.fullName, positionName: a.positionName }))
}

function visibleTo(
  isPrivileged: boolean,
  authUserId: string,
  requesterId: string,
  chain: ChainApprover[],
): boolean {
  // Owner / admin tenant & hub-admin bisa semua — lihat seluruh antrean.
  if (isPrivileged) return true
  if (chain.some((a) => a.userId === authUserId)) return true
  if (requesterId === authUserId && chain.length > 0) return false
  return false
}

// Items waiting for the caller's approval (RACI queue).
approvalsRouter.get('/pending', async (c) => {
  const tenant = c.get('tenant')
  const authUser = c.get('user')
  const isPrivileged =
    authUser.platformRole === 'hub-admin' ||
    tenant.tenantRole === 'owner' ||
    tenant.tenantRole === 'admin'

  const items: PendingItem[] = []

  const push = async (
    kind: PendingItem['kind'],
    row: {
      id: string
      requesterId: string
      requesterName: string | null
      title: string
      detail: string
      createdAt: Date
      amount?: string | number | null
      levelChain?: boolean
    },
  ) => {
    const chain = row.levelChain
      ? await resolveLevelApproverChain(tenant.tenantId, row.requesterId)
      : await resolveApprovalChain(tenant.tenantId, row.requesterId, { amount: row.amount })
    if (!visibleTo(isPrivileged, authUser.id, row.requesterId, chain)) return
    items.push({
      kind,
      id: row.id,
      requesterId: row.requesterId,
      requesterName: row.requesterName,
      title: row.title,
      detail: row.detail,
      createdAt: row.createdAt,
      approvers: toApprovers(chain),
    })
  }

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

  for (const r of pendingLeaves) {
    await push('leave', {
      id: r.id,
      requesterId: r.userId,
      requesterName: r.userFullName,
      title: r.title,
      detail: `${r.detail} hari`,
      createdAt: r.createdAt,
    })
  }

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

  for (const r of pendingOvertime) {
    await push('overtime', {
      id: r.id,
      requesterId: r.userId,
      requesterName: r.userFullName,
      title: `Lembur ${r.title}`,
      detail: `${r.detail} jam`,
      createdAt: r.createdAt,
    })
  }

  const pendingExpenses = await db
    .select({
      id: expenseClaims.id,
      userId: expenseClaims.submittedBy,
      userFullName: users.fullName,
      title: expenseClaims.title,
      detail: expenseClaims.amount,
      createdAt: expenseClaims.createdAt,
      amount: expenseClaims.amount,
    })
    .from(expenseClaims)
    .innerJoin(users, eq(expenseClaims.submittedBy, users.id))
    .where(and(eq(expenseClaims.tenantId, tenant.tenantId), eq(expenseClaims.status, 'submitted')))

  for (const r of pendingExpenses) {
    await push('expense', {
      id: r.id,
      requesterId: r.userId,
      requesterName: r.userFullName,
      title: r.title,
      detail: `Rp ${Number(r.detail).toLocaleString('id-ID')}`,
      createdAt: r.createdAt,
      amount: r.amount,
    })
  }

  const pendingQuotes = await db
    .select({
      id: quotations.id,
      userId: quotations.createdBy,
      userFullName: users.fullName,
      title: quotations.title,
      detail: quotations.grandTotal,
      createdAt: quotations.createdAt,
    })
    .from(quotations)
    .innerJoin(users, eq(quotations.createdBy, users.id))
    .where(
      and(
        eq(quotations.tenantId, tenant.tenantId),
        eq(quotations.status, 'pending_approval'),
      ),
    )

  for (const r of pendingQuotes) {
    await push('quotation', {
      id: r.id,
      requesterId: r.userId,
      requesterName: r.userFullName,
      title: r.title,
      detail: `Rp ${Number(r.detail).toLocaleString('id-ID')}`,
      createdAt: r.createdAt,
      levelChain: true,
    })
  }

  const pendingPRs = await db
    .select({
      id: purchaseRequests.id,
      userId: purchaseRequests.requesterId,
      userFullName: users.fullName,
      title: purchaseRequests.title,
      detail: purchaseRequests.estimatedTotalCost,
      createdAt: purchaseRequests.createdAt,
      amount: purchaseRequests.estimatedTotalCost,
    })
    .from(purchaseRequests)
    .innerJoin(users, eq(purchaseRequests.requesterId, users.id))
    .where(and(eq(purchaseRequests.tenantId, tenant.tenantId), eq(purchaseRequests.status, 'submitted')))

  for (const r of pendingPRs) {
    await push('pr', {
      id: r.id,
      requesterId: r.userId,
      requesterName: r.userFullName,
      title: r.title,
      detail: `Rp ${Number(r.detail).toLocaleString('id-ID')}`,
      createdAt: r.createdAt,
      amount: r.amount,
    })
  }

  const pendingPOs = await db
    .select({
      id: pos.id,
      userId: pos.createdBy,
      userFullName: users.fullName,
      title: pos.poNumber,
      detail: pos.totalAmount,
      createdAt: pos.createdAt,
      amount: pos.totalAmount,
      status: pos.status,
    })
    .from(pos)
    .innerJoin(users, eq(pos.createdBy, users.id))
    .where(
      and(
        eq(pos.tenantId, tenant.tenantId),
        eq(pos.status, 'pending_approval'),
      ),
    )

  for (const r of pendingPOs) {
    await push('po', {
      id: r.id,
      requesterId: r.userId,
      requesterName: r.userFullName,
      title: `PO ${r.title}`,
      detail: `Rp ${Number(r.detail).toLocaleString('id-ID')}`,
      createdAt: r.createdAt,
      amount: r.amount,
    })
  }

  const pendingComplPOs = await db
    .select({
      id: purchaseOrders.id,
      userId: purchaseOrders.issuedBy,
      userFullName: users.fullName,
      title: purchaseOrders.poNumber,
      detail: purchaseOrders.grandTotal,
      createdAt: purchaseOrders.createdAt,
      amount: purchaseOrders.grandTotal,
      status: purchaseOrders.status,
    })
    .from(purchaseOrders)
    .innerJoin(users, eq(purchaseOrders.issuedBy, users.id))
    .where(
      and(
        eq(purchaseOrders.tenantId, tenant.tenantId),
        eq(purchaseOrders.status, 'draft'),
      ),
    )

  // Only draft complimentary POs whose amount is above threshold need owner escalation;
  // parent-chain members still see them if they would approve via requireApprover on send.
  // Skip auto-listing drafts (not submitted) to avoid noise — only list when pending_approval
  // is not used by this table. Complimentary POs are approved on draft → sent_to_vendor,
  // so list high-value drafts that exceed threshold.
  const thresholdRow = await db.query.tenants.findFirst({
    where: eq(tenants.id, tenant.tenantId),
    columns: { approvalThreshold: true },
  })
  const threshold = Number(thresholdRow?.approvalThreshold ?? 10_000_000)

  for (const r of pendingComplPOs) {
    if (Number(r.amount) < threshold) continue
    await push('cpo', {
      id: r.id,
      requesterId: r.userId,
      requesterName: r.userFullName,
      title: `PO ${r.title}`,
      detail: `Rp ${Number(r.detail).toLocaleString('id-ID')}`,
      createdAt: r.createdAt,
      amount: r.amount,
    })
  }

  items.sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt))

  return c.json({ items, total: items.length })
})

export default approvalsRouter
