import { isNull } from 'drizzle-orm'
import { users } from '../db/schema'

/**
 * Satu-satunya definisi "user masih ada" untuk semua query DIREKTORI.
 *
 * Pakai predicate ini di endpoint yang menampilkan daftar orang (users,
 * members, picker assignee, notifikasi). Menuliskan `isNull(users.deletedAt)`
 * secara manual di tiap route adalah sumber ghost member: satu route lupa,
 * akun yang sudah dihapus muncul lagi.
 *
 * View HISTORI / AUDIT sengaja TIDAK memakai predicate ini — mereka harus
 * tetap bisa join ke tombstone supaya invoice, absensi, dan approval tetap
 * menunjukkan siapa yang membuat/menyetujui record.
 */
export const notDeletedUser = isNull(users.deletedAt)
