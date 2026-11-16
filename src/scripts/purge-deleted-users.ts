/**
 * Job pembersihan tombstone akun yang sudah melewati masa retensi.
 *
 * DRY-RUN by default. Jalankan:
 *   npm run purge:deleted-users          (hanya laporan)
 *   npm run purge:deleted-users:apply    (benar-benar menghapus)
 *
 * Kenapa tidak langsung DELETE semua user yang sudah lama dihapus:
 *  - 14 FK `ON DELETE RESTRICT` pada kolom NOT NULL (invoice, PO, payment,
 *    project, task, quotation, expense claim, ...). Satu baris histori saja
 *    membuat DELETE gagal dengan 23503.
 *  - `system_audit_logs.user_id` memakai ON DELETE SET NULL, jadi menghapus
 *    baris user akan menghilangkan jejak "siapa melakukan apa".
 *
 * Karena itu job ini HANYA menghapus fisik tombstone yang benar-benar tidak
 * punya referensi historis maupun akses. Sisanya tetap disimpan sebagai
 * tombstone anonim (sudah dianonimisasi saat deprovision) — ini sejalan
 * dengan kewajiban menyimpan catatan akuntansi/payroll.
 */
import { sql } from 'drizzle-orm'
import { inArray } from 'drizzle-orm'
import { db, closeDb } from '../db'
import { users } from '../db/schema'
import { ARCHIVE_RETENTION_DAYS } from '../lib/retention'

// Semua tabel yang membuat baris users TIDAK BOLEH dihapus.
// Daftar ini sengaja eksplisit: kalau ada modul baru dengan FK ke users,
// tambahkan di sini supaya job purge tidak pernah merusak histori.
const BLOCKERS = `
  EXISTS (SELECT 1 FROM invoices i WHERE i.created_by = u.id)
  OR EXISTS (SELECT 1 FROM projects p WHERE p.created_by = u.id OR p.project_manager_id = u.id)
  OR EXISTS (SELECT 1 FROM purchase_orders po WHERE po.issued_by = u.id)
  OR EXISTS (SELECT 1 FROM purchase_requests pr WHERE pr.requester_id = u.id)
  OR EXISTS (SELECT 1 FROM pos p2 WHERE p2.created_by = u.id)
  OR EXISTS (SELECT 1 FROM support_tickets st WHERE st.reported_by = u.id)
  OR EXISTS (SELECT 1 FROM payments_received pay WHERE pay.received_by = u.id)
  OR EXISTS (SELECT 1 FROM task_comments tc WHERE tc.user_id = u.id)
  OR EXISTS (SELECT 1 FROM tasks t WHERE t.created_by = u.id)
  OR EXISTS (SELECT 1 FROM goods_receipts gr WHERE gr.received_by = u.id)
  OR EXISTS (SELECT 1 FROM quotations q WHERE q.created_by = u.id)
  OR EXISTS (SELECT 1 FROM expense_claims ec WHERE ec.submitted_by = u.id)
  OR EXISTS (SELECT 1 FROM stock_movements sm WHERE sm.performed_by = u.id)
  OR EXISTS (SELECT 1 FROM system_audit_logs sal WHERE sal.user_id = u.id)
  OR EXISTS (SELECT 1 FROM tenant_members tm WHERE tm.user_id = u.id)
  OR EXISTS (SELECT 1 FROM user_roles ur WHERE ur.user_id = u.id)
  OR EXISTS (SELECT 1 FROM refresh_tokens rt WHERE rt.user_id = u.id)
`

interface Candidate {
  id: string
  full_name: string | null
  deleted_at: Date
}

const cutoff = `NOW() - (${ARCHIVE_RETENTION_DAYS} * INTERVAL '1 day')`

async function main() {
  const apply = process.argv.includes('--apply')

  const [allRows, safeRows] = await Promise.all([
    db.execute(sql.raw(`
      SELECT count(*)::int AS total
        FROM users u
       WHERE u.deleted_at IS NOT NULL
         AND u.deleted_at < ${cutoff}
    `)),
    db.execute(sql.raw(`
      SELECT u.id, u.full_name, u.deleted_at
        FROM users u
       WHERE u.deleted_at IS NOT NULL
         AND u.deleted_at < ${cutoff}
         AND NOT (${BLOCKERS})
       ORDER BY u.deleted_at
    `)),
  ])

  const total = Number((allRows as unknown as Array<{ total: number }>)[0]?.total ?? 0)
  const safe = safeRows as unknown as Candidate[]

  console.log(`[purge] mode            : ${apply ? 'APPLY' : 'DRY-RUN'}`)
  console.log(`[purge] retention       : ${ARCHIVE_RETENTION_DAYS} hari`)
  console.log(`[purge] kandidat        : ${total}`)
  console.log(`[purge] aman dihapus    : ${safe.length}`)
  console.log(`[purge] tetap disimpan  : ${total - safe.length} (punya riwayat/akses/audit)`)

  if (!apply) {
    console.log('[purge] Tidak ada perubahan. Tambahkan --apply untuk mengeksekusi.')
    return
  }

  if (safe.length === 0) {
    console.log('[purge] Tidak ada baris yang bisa dihapus.')
    return
  }

  for (let i = 0; i < safe.length; i += 50) {
    const batch = safe.slice(i, i + 50).map((r) => r.id)
    await db.delete(users).where(inArray(users.id, batch))
    console.log(`[purge] dihapus ${Math.min(i + 50, safe.length)}/${safe.length}`)
  }

  console.log('[purge] selesai.')
}

main()
  .catch((err) => {
    console.error('[purge] gagal:', err)
    process.exitCode = 1
  })
  .finally(async () => {
    await closeDb()
  })
