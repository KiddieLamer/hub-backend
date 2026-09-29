import { describe, it, expect } from 'vitest'
import { parsePagination, paginated, DEFAULT_PAGE, DEFAULT_LIMIT, MAX_LIMIT } from './pagination'
import type { Context } from 'hono'

// Minimal mock Context for pagination: only req.query() is used.
function mockContext(query: Record<string, string> = {}): Context {
  return {
    req: {
      query: (key?: string) => (key === undefined ? query : query[key]),
    },
  } as unknown as Context
}

describe('parsePagination', () => {
  it('returns defaults when no query params are present', () => {
    const p = parsePagination(mockContext())
    expect(p).toEqual({ page: DEFAULT_PAGE, limit: DEFAULT_LIMIT, offset: 0 })
  })

  it('parses valid page and limit', () => {
    const p = parsePagination(mockContext({ page: '3', limit: '20' }))
    expect(p).toEqual({ page: 3, limit: 20, offset: 40 })
  })

  it('clamps limit to MAX_LIMIT (100)', () => {
    const p = parsePagination(mockContext({ limit: '5000' }))
    expect(p.limit).toBe(MAX_LIMIT)
  })

  it('falls back to default page when page is invalid (0, negative, NaN)', () => {
    expect(parsePagination(mockContext({ page: '0' })).page).toBe(DEFAULT_PAGE)
    expect(parsePagination(mockContext({ page: '-5' })).page).toBe(DEFAULT_PAGE)
    expect(parsePagination(mockContext({ page: 'abc' })).page).toBe(DEFAULT_PAGE)
  })

  it('falls back to default limit when limit is invalid', () => {
    expect(parsePagination(mockContext({ limit: '0' })).limit).toBe(DEFAULT_LIMIT)
    expect(parsePagination(mockContext({ limit: '-1' })).limit).toBe(DEFAULT_LIMIT)
    expect(parsePagination(mockContext({ limit: 'oops' })).limit).toBe(DEFAULT_LIMIT)
  })

  it('respects custom defaultLimit and maxLimit options', () => {
    const p1 = parsePagination(mockContext(), { defaultLimit: 10, maxLimit: 25 })
    expect(p1.limit).toBe(10)
    const p2 = parsePagination(mockContext({ limit: '999' }), { maxLimit: 25 })
    expect(p2.limit).toBe(25)
  })

  it('computes offset from page and limit', () => {
    const p = parsePagination(mockContext({ page: '4', limit: '10' }))
    expect(p.offset).toBe(30)
  })
})

describe('paginated', () => {
  it('returns shape with key, total, page, limit', () => {
    const data = [{ id: 1 }, { id: 2 }]
    const result = paginated('invoices', data, 42, { page: 2, limit: 10, offset: 10 })
    expect(result).toEqual({
      invoices: data,
      total: 42,
      page: 2,
      limit: 10,
    })
  })

  it('uses the provided key as collection name', () => {
    const result = paginated('users', [], 0, { page: 1, limit: 50, offset: 0 })
    expect(result).toHaveProperty('users')
    expect(result.users).toEqual([])
  })
})
