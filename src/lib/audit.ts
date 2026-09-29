import type { Context } from 'hono'
import { db } from '../db'
import { systemAuditLogs } from '../db/schema'

export interface AuditEntry {
  /** Short verb describing the mutation, e.g. 'role.update', 'user.suspend'. */
  action: string
  /** Module scope, e.g. 'umas', 'tenants', 'compliance'. */
  module: string
  /** Primary key of the affected record, if any. */
  recordId?: string | null
  /** Snapshot before the change. */
  oldValues?: Record<string, unknown> | null
  /** Snapshot after the change. */
  newValues?: Record<string, unknown> | null
}

/**
 * Record a sensitive mutation into `system_audit_logs`.
 *
 * Best-effort: audit writes must never break the caller's request. On failure
 * we log to stderr and swallow the error so the underlying mutation still
 * returns successfully. Callers that need strict auditing should write their
 * own transaction instead.
 */
export async function recordAudit(
  c: Context,
  tenantId: string,
  entry: AuditEntry,
): Promise<void> {
  try {
    const authUser = c.get('user') as { id?: string } | undefined
    await db.insert(systemAuditLogs).values({
      tenantId,
      userId: authUser?.id ?? null,
      action: entry.action,
      module: entry.module,
      recordId: entry.recordId ?? null,
      ipAddress:
        c.req.header('x-forwarded-for') || c.req.header('x-real-ip') || null,
      userAgent: c.req.header('user-agent') || null,
      oldValues: entry.oldValues ? JSON.stringify(entry.oldValues) : null,
      newValues: entry.newValues ? JSON.stringify(entry.newValues) : null,
    })
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[audit] failed to record entry', entry.action, err)
  }
}
