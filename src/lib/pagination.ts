import { Context } from 'hono'

/**
 * Standar pagination Hub.
 *
 * Semua endpoint list (GET) yang memakai helper ini menerima query:
 *   ?page=1&limit=50   (default page=1, limit=50, max 100)
 *
 * Respons yang diharapkan konsumen:
 *   { <collection>: [...], total, page, limit }
 *
 * Kenapa default 50 (bukan tanpa limit): tenant besar bisa punya ribuan
 * baris (invoices, attendances). Tanpa batas, satu request bisa menarik
 * seluruh tabel dan menghabiskan memori worker.
 */
export const DEFAULT_PAGE = 1
export const DEFAULT_LIMIT = 50
export const MAX_LIMIT = 100

export interface Pagination {
  page: number
  limit: number
  offset: number
}

function toInt(value: unknown): number | null {
  const n = Number.parseInt(String(value ?? ''), 10)
  return Number.isFinite(n) ? n : null
}

/**
 * Parse ?page & ?limit dari request dengan clamping aman.
 * Nilai tidak valid tidak error — fallback ke default supaya endpoint list
 * tidak pernah 500 hanya karena query string jelek.
 */
export function parsePagination(c: Context, opts?: { defaultLimit?: number; maxLimit?: number }): Pagination {
  const defaultLimit = opts?.defaultLimit ?? DEFAULT_LIMIT
  const maxLimit = opts?.maxLimit ?? MAX_LIMIT

  const rawPage = toInt(c.req.query('page'))
  const rawLimit = toInt(c.req.query('limit'))

  const page = rawPage && rawPage > 0 ? rawPage : DEFAULT_PAGE
  const limit = rawLimit && rawLimit > 0 ? Math.min(rawLimit, maxLimit) : defaultLimit

  return { page, limit, offset: (page - 1) * limit }
}

/**
 * Bentuk respons list yang konsisten.
 * `key` = nama koleksi (mis. 'invoices'), supaya frontend tetap kompatibel
 * dan tahu isi array-nya di mana.
 */
export function paginated<T>(key: string, data: T[], total: number, pagination: Pagination) {
  return {
    [key]: data,
    total,
    page: pagination.page,
    limit: pagination.limit,
  }
}
