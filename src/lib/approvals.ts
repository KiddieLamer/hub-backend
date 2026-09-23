import { Context, Next } from 'hono'
import { eq, and } from 'drizzle-orm'
import { db } from '../db'
import { tenantMembers, positions, users } from '../db/schema'
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
  // always appended to the chain even if hierarchy already covers it.
  amount?: number | string | null
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

// Resolve the approval chain for a requester: walk up the position parents
// (holders of each parent position), then tenant owners. Requester is
// excluded everywhere. Owners always close the chain (also covers the
// "no parent" and "nominal >= threshold" cases).
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

  // Owners close the chain (also the fallback when there is no hierarchy).
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
    if (o.userId === requesterUserId) continue
    push({
      userId: o.userId,
      fullName: o.fullName,
      positionName: null,
      positionLevel: null,
      memberRole: o.memberRole,
    })
  }

  void opts
  return chain
}

export interface ApprovalTarget {
  requesterUserId: string
  amount?: number | string | null
}

// Route guard: only the requester's chain (or hub-admin, or the requester
// themselves when nobody else can approve — solo-operator fallback) may
// approve/reject. Responds 403 with the chain so the UI can show
// "menunggu persetujuan: ...".
export function requireApprover(
  resolveTarget: (c: Context) => Promise<ApprovalTarget | null>,
) {
  return async (c: Context, next: Next) => {
    const user = c.get('user') as AuthUser | undefined
    const tenant = c.get('tenant') as { tenantId?: string } | undefined
    if (!user) {
      return c.json({ error: 'Unauthorized' }, 401)
    }
    if (!tenant?.tenantId) {
      return c.json({ error: 'Tenant context required' }, 400)
    }
    if (user.platformRole === 'hub-admin') {
      await next()
      return
    }

    const target = await resolveTarget(c)
    if (!target) {
      return c.json({ error: 'Request not found' }, 404)
    }

    const chain = await resolveApprovalChain(tenant.tenantId, target.requesterUserId, {
      amount: target.amount,
    })

    if (chain.some((a) => a.userId === user.id)) {
      await next()
      return
    }

    if (chain.length === 0 && target.requesterUserId === user.id) {
      await next()
      return
    }

    return c.json(
      {
        error: 'Hanya atasan langsung atau owner yang dapat menyetujui',
        approvers: chain,
      },
      403,
    )
  }
}
