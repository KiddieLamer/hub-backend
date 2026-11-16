/**
 * Masa tenggang arsip akun (hari).
 *
 * Selama jendela ini akun yang sudah dihapus masih bisa dipulihkan lewat
 * POST /api/users/:id/restore. Setelah itu job purge boleh membersihkan
 * tombstone yang aman dihapus.
 *
 * Satu konstanta dipakai bersama oleh endpoint restore, daftar arsip, dan
 * skrip purge supaya angkanya tidak bisa beda-beda di tiga tempat.
 */
export const ARCHIVE_RETENTION_DAYS = 90

export const ARCHIVE_RETENTION_MS = ARCHIVE_RETENTION_DAYS * 24 * 60 * 60 * 1000

export function isWithinRetention(deletedAt: Date | string | null): boolean {
  if (!deletedAt) return false
  const ts = new Date(deletedAt).getTime()
  if (Number.isNaN(ts)) return false
  return Date.now() - ts < ARCHIVE_RETENTION_MS
}

export function purgeAfter(deletedAt: Date | string): Date {
  return new Date(new Date(deletedAt).getTime() + ARCHIVE_RETENTION_MS)
}
