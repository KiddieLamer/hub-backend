import { and, count, eq, ne } from 'drizzle-orm'
import { db } from '../db'
import { users, tenantMembers, userRoles, refreshTokens } from '../db/schema'

/**
 * Dilempar kalau akun yang mau dihapus adalah satu-satunya owner sebuah
 * tenant. Menghapus membership owner itu akan meninggalkan company tanpa
 * pemilik. Route harus membalas 409 dan meminta transfer ownership dulu.
 */
export class SoleOwnerError extends Error {
  constructor(public readonly tenantIds: string[]) {
    super('User is the sole owner of one or more tenants')
    this.name = 'SoleOwnerError'
  }
}

export interface DeprovisionResult {
  userId: string
  previousEmail: string
  previousStatus: string
  tenantIds: string[]
}

/**
 * Revoke a user's access everywhere and anonymise their contact data, while
 * keeping the `users` row as a tombstone.
 *
 * The row must stay: 43 foreign keys point at `users.id`, many of them
 * ON DELETE RESTRICT on NOT NULL columns (invoices.created_by,
 * purchase_orders.issued_by, payments_received.received_by, ...). Deleting it
 * would either fail at the DB or destroy financial / attendance / approval
 * history. What "deleted" means to a user of the product is: no access, no
 * membership, no PII in any directory — not a physically removed row.
 *
 * Everything runs in one transaction. A partial deprovision is exactly what
 * used to happen before: `deleted_at` was set but `tenant_members` survived,
 * so the account kept showing up as a ghost member on the Company page.
 *
 * `fullName` is intentionally retained: historical views and audit trails
 * still need to show who created/approved a record. Contact details (email,
 * phone, KTP, address, DOB, avatar) are the PII we scrub. A scheduled purge
 * job can physically remove the row after the retention window.
 */
export async function deprovisionUser(
  userId: string,
): Promise<DeprovisionResult | null> {
  return db.transaction(async (tx) => {
    const user = await tx.query.users.findFirst({
      where: eq(users.id, userId),
      columns: {
        id: true,
        email: true,
        status: true,
        deletedAt: true,
      },
    })

    if (!user || user.deletedAt) return null

    const memberships = await tx
      .select({ tenantId: tenantMembers.tenantId })
      .from(tenantMembers)
      .where(eq(tenantMembers.userId, userId))
    const tenantIds = memberships.map((m) => m.tenantId)

    // Jangan biarkan company kehilangan owner terakhir. `DELETE /api/members`
    // sudah punya proteksi ini untuk penghapusan per-tenant; jalur hapus akun
    // global tidak boleh mem-bypass-nya. Throw di dalam transaksi = rollback.
    const ownedTenants = await tx
      .select({ tenantId: tenantMembers.tenantId })
      .from(tenantMembers)
      .where(and(eq(tenantMembers.userId, userId), eq(tenantMembers.role, 'owner')))

    const blockedTenantIds: string[] = []
    for (const owned of ownedTenants) {
      const otherOwners = await tx
        .select({ total: count() })
        .from(tenantMembers)
        .where(and(
          eq(tenantMembers.tenantId, owned.tenantId),
          eq(tenantMembers.role, 'owner'),
          ne(tenantMembers.userId, userId),
        ))
      if (Number(otherOwners[0]?.total ?? 0) === 0) {
        blockedTenantIds.push(owned.tenantId)
      }
    }
    if (blockedTenantIds.length > 0) {
      throw new SoleOwnerError(blockedTenantIds)
    }

    // 1. Kill every session (access tokens are short-lived and guarded by
    //    authMiddleware checking deletedAt / status).
    await tx
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(eq(refreshTokens.userId, userId))

    // 2. Remove access grants and memberships from ALL tenants, not just the
    //    tenant currently selected in the UI.
    await tx.delete(userRoles).where(eq(userRoles.userId, userId))
    await tx.delete(tenantMembers).where(eq(tenantMembers.userId, userId))

    // 3. Anonymise PII and mark the account as deleted. The email must stay
    //    unique so the original address can be registered again.
    const now = new Date()
    await tx
      .update(users)
      .set({
        email: `deleted-${user.id}@deleted.invalid`,
        phoneNumber: null,
        avatarUrl: null,
        employeeId: null,
        jobTitle: null,
        department: null,
        dateOfBirth: null,
        ktpNumber: null,
        address: null,
        managerId: null,
        twoFactorSecret: null,
        is2faEnabled: false,
        currentTenantId: null,
        status: 'inactive',
        deletedAt: now,
        updatedAt: now,
      })
      .where(eq(users.id, userId))

    return {
      userId,
      previousEmail: user.email,
      previousStatus: user.status,
      tenantIds,
    }
  })
}
