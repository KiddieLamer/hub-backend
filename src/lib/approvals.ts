import { Context, Next } from 'hono'
import { eq, and } from 'drizzle-orm'
import { db } from '../db'
import { tenantMembers, positions, users, tenants } from '../db/schema'
import type { AuthUser } from '../middleware/auth'

export interface ChainApprover {
  userId: string
  fullName: string | null
  positionName: string | null
  positionLevel: number | null
  memberRole: string
}

export interface ChainOptions {
  // Nominal (rupiah). At or above the tenant threshold, an owner is
  // always appended even if the hierarchy already has parents.
  // Below the threshold, owners are only a fallback when no parent exists.
  amount?: number | string | null
}

export interface ApproverCheckOptions extends ChainOptions {
  // Optional permission the caller must hold (owner/admin/hub-admin bypass).
  permission?: string
  // 'parent' = position parent chain (default); 'level60' = position level >= 60.
  chainType?: 'parent' | 'level60'
  // Custom 403 message (default mentions direct manager / owner).
  message?: string
}

async function memberPosition(tenantId: string, userId: string) {
  const membership = await db.query.tenantMembers.findFirst({
    where: and(eq(tenantMembers.userId, userId), eq(tenantMembers.tenantId, tenantId)),
  })
  if (!membership?.positionId) return { membership, position: null }
  const position = await db.query.positions.findFirst({
    where: and(eq(positions.id, membership.positionId), eq(positions.tenantId, tenantId)),
  })
  return { membership, position }
}

async function holdersOfPosition(tenantId: string, positionId: string, excludeUserId: string) {
  const rows = await db
    .select({
      userId: tenantMembers.userId,
      fullName: users.fullName,
      memberRole: tenantMembers.role,
    })
    .from(tenantMembers)
    .innerJoin(users, eq(tenantMembers.userId, users.id))
    .where(and(eq(tenantMembers.tenantId, tenantId), eq(tenantMembers.positionId, positionId)))
  return rows.filter((r) => r.userId !== excludeUserId)
}

async function appendOwners(
  tenantId: string,
  requesterUserId: string,
  chain: ChainApprover[],
  seen: Set<string>,
) {
  const ownerRows = await db
    .select({
      userId: tenantMembers.userId,
      fullName: users.fullName,
      memberRole: tenantMembers.role,
    })
    .from(tenantMembers)
    .innerJoin(users, eq(tenantMembers.userId, users.id))
    .where(and(eq(tenantMembers.tenantId, tenantId), eq(tenantMembers.role, 'owner')))
  for (const o of ownerRows) {
    if (seen.has(o.userId)) continue
    seen.add(o.userId)
    chain.push({
      userId: o.userId,
      fullName: o.fullName,
      positionName: null,
      positionLevel: null,
      memberRole: o.memberRole,
    })
  }
}

async function tenantThreshold(tenantId: string): Promise<number> {
  const row = await db.query.tenants.findFirst({
    where: eq(tenants.id, tenantId),
    columns: { approvalThreshold: true },
  })
  return Number(row?.approvalThreshold ?? 10_000_000)
}

// Parent chain: walk up position parents (holders of each), then owners.
// Requester excluded. With amount below threshold, owners are only
// appended when no parent approvers exist (fallback).
export async function resolveApprovalChain(
  tenantId: string,
  requesterUserId: string,
  opts: ChainOptions = {},
): Promise<ChainApprover[]> {
  const chain: ChainApprover[] = []
  const seen = new Set<string>([requesterUserId])

  const push = (a: ChainApprover) => {
    if (!seen.has(a.userId)) {
      seen.add(a.userId)
      chain.push(a)
    }
  }

  const { position } = await memberPosition(tenantId, requesterUserId)

  let parentId = position?.parentId ?? null
  const seenPositions = new Set<string>()
  while (parentId && !seenPositions.has(parentId)) {
    seenPositions.add(parentId)
    const parent = await db.query.positions.findFirst({
      where: and(eq(positions.id, parentId), eq(positions.tenantId, tenantId)),
    })
    if (!parent) break
    const holders = await holdersOfPosition(tenantId, parent.id, requesterUserId)
    for (const h of holders) {
      push({
        userId: h.userId,
        fullName: h.fullName,
        positionName: parent.name,
        positionLevel: parent.level,
        memberRole: h.memberRole,
      })
    }
    parentId = parent.parentId
  }

  let mustIncludeOwners = true
  if (opts.amount !== undefined && opts.amount !== null && opts.amount !== '') {
    const amount = Number(opts.amount)
    const threshold = await tenantThreshold(tenantId)
    // Below threshold with parents already in the chain: owners only as fallback.
    if (Number.isFinite(amount) && amount < threshold && chain.length > 0) {
      mustIncludeOwners = false
    }
  }

  if (mustIncludeOwners || chain.length === 0) {
    await appendOwners(tenantId, requesterUserId, chain, seen)
  }

  return chain
}

// Quotation RACI: members whose position level >= 60 (Project Lead / setara).
// Owners always qualify as a fallback.
export async function resolveLevelApproverChain(
  tenantId: string,
  requesterUserId: string,
  minLevel = 60,
): Promise<ChainApprover[]> {
  const chain: ChainApprover[] = []
  const seen = new Set<string>([requesterUserId])

  const rows = await db
    .select({
      userId: tenantMembers.userId,
      fullName: users.fullName,
      memberRole: tenantMembers.role,
      positionId: tenantMembers.positionId,
      positionName: positions.name,
      positionLevel: positions.level,
    })
    .from(tenantMembers)
    .innerJoin(users, eq(tenantMembers.userId, users.id))
    .leftJoin(positions, eq(tenantMembers.positionId, positions.id))
    .where(eq(tenantMembers.tenantId, tenantId))

  for (const r of rows) {
    if (r.positionLevel !== null && Number(r.positionLevel) >= minLevel && !seen.has(r.userId)) {
      seen.add(r.userId)
      chain.push({
        userId: r.userId,
        fullName: r.fullName,
        positionName: r.positionName,
        positionLevel: Number(r.positionLevel),
        memberRole: r.memberRole,
      })
    }
  }

  await appendOwners(tenantId, requesterUserId, chain, seen)
  return chain
}

export interface ApprovalTarget {
  requesterUserId: string
  amount?: number | string | null
}

export async function checkApprover(
  c: Context,
  tenantId: string,
  target: ApprovalTarget,
  opts: ApproverCheckOptions = {},
): Promise<{ allowed: boolean; chain: ChainApprover[]; bypass: boolean; permissionDenied: boolean }> {
  const user = c.get('user') as AuthUser | undefined
  const tenantRole = (c.get('tenant') as { tenantRole?: string } | undefined)?.tenantRole
  if (!user) return { allowed: false, chain: [], bypass: false, permissionDenied: false }

  const isBypass =
    user.platformRole === 'hub-admin' || tenantRole === 'owner' || tenantRole === 'admin'

  if (isBypass) {
    return { allowed: true, chain: [], bypass: true, permissionDenied: false }
  }

  const chain =
    opts.chainType === 'level60'
      ? await resolveLevelApproverChain(tenantId, target.requesterUserId)
      : await resolveApprovalChain(tenantId, target.requesterUserId, { amount: target.amount })

  const inChain =
    chain.some((a) => a.userId === user.id) ||
    (chain.length === 0 && target.requesterUserId === user.id)

  if (!inChain) {
    return { allowed: false, chain, bypass: false, permissionDenied: false }
  }

  if (opts.permission && !user.permissions?.includes(opts.permission)) {
    return { allowed: false, chain, bypass: false, permissionDenied: true }
  }

  return { allowed: true, chain, bypass: false, permissionDenied: false }
}

// Route guard: only the RACI chain (or hub-admin / tenant owner/admin)
// may approve/reject. Responds 403 with the chain so the UI can show
// "menunggu persetujuan: ...".
export function requireApprover(
  resolveTarget: (c: Context) => Promise<ApprovalTarget | null>,
  opts: ApproverCheckOptions = {},
) {
  return async (c: Context, next: Next) => {
    const user = c.get('user') as AuthUser | undefined
    const tenant = c.get('tenant') as { tenantId?: string; tenantRole?: string } | undefined
    if (!user) {
      return c.json({ error: 'Unauthorized' }, 401)
    }
    if (!tenant?.tenantId) {
      return c.json({ error: 'Tenant context required' }, 400)
    }

    const target = await resolveTarget(c)
    if (!target) {
      return c.json({ error: 'Request not found' }, 404)
    }

    const result = await checkApprover(c, tenant.tenantId, target, opts)

    if (result.allowed) {
      await next()
      return
    }

    return c.json(
      {
        error: result.permissionDenied
          ? `Butuh permission ${opts.permission} untuk menyetujui`
          : (opts.message ?? 'Hanya atasan langsung atau owner yang dapat menyetujui'),
        approvers: result.chain,
      },
      403,
    )
  }
}
