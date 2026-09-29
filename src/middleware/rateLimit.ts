import { Context, Next } from 'hono'
import { and, eq, lt, sql } from 'drizzle-orm'
import { db } from '../db'
import { loginAttempts } from '../db/schema'

/**
 * Rate limiter + login lockout.
 *
 * The generic rate-limit counter (`store`) is still per-process / in-memory:
 * it is coarse abuse dampening, not a hard security boundary. Login lockout is
 * now persisted in Postgres (`login_attempts`) so it survives restarts and is
 * shared across PM2 cluster workers.
 */

interface RateLimitEntry {
  count: number
  resetAt: number
}

interface RateLimitOpts {
  windowMs: number
  max: number
}

const store = new Map<string, RateLimitEntry>()

// Periodic cleanup so long-idle in-memory keys don't accumulate forever.
const CLEANUP_INTERVAL_MS = 60_000
setInterval(() => {
  const now = Date.now()
  for (const [key, entry] of store) {
    if (now > entry.resetAt) store.delete(key)
  }
}, CLEANUP_INTERVAL_MS).unref?.()

// Best-effort sweep of stale lockout rows (older than 24h past their lock).
const LOCKOUT_SWEEP_MS = 60 * 60 * 1000
setInterval(() => {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000)
  db.delete(loginAttempts)
    .where(lt(loginAttempts.updatedAt, cutoff))
    .catch(() => {
      /* best-effort; never crash the process on a sweep failure */
    })
}, LOCKOUT_SWEEP_MS).unref?.()

function clientIp(c: Context): string {
  return (
    c.req.header('cf-connecting-ip') ||
    c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ||
    c.req.header('x-real-ip') ||
    'unknown'
  )
}

/**
 * Shared in-memory limiter body. `key` already includes IP (+ optional path).
 */
function consume(key: string, opts: RateLimitOpts, c: Context): { limited: boolean; retryAfter: number } {
  const now = Date.now()

  let entry = store.get(key)
  if (!entry || now > entry.resetAt) {
    entry = { count: 0, resetAt: now + opts.windowMs }
    store.set(key, entry)
  }

  entry.count += 1
  const count = entry.count

  c.header('X-RateLimit-Limit', String(opts.max))
  c.header('X-RateLimit-Remaining', String(Math.max(0, opts.max - count)))
  c.header('X-RateLimit-Reset', String(Math.ceil(entry.resetAt / 1000)))

  if (count > opts.max) {
    const retryAfter = Math.ceil((entry.resetAt - now) / 1000)
    return { limited: true, retryAfter }
  }

  return { limited: false, retryAfter: 0 }
}

export function rateLimit(opts: RateLimitOpts) {
  return async (c: Context, next: Next) => {
    const key = `${clientIp(c)}:${c.req.path}`
    const { limited, retryAfter } = consume(key, opts, c)

    if (limited) {
      c.header('Retry-After', String(retryAfter))
      return c.json({ error: 'Terlalu banyak percobaan. Coba lagi nanti.' }, 429)
    }

    await next()
  }
}

// Paths that must always stay reachable: health checks and the root probe.
const GLOBAL_LIMIT_EXEMPT_PATHS = new Set(['/health', '/'])

/**
 * Global rate limit: ~100 requests/minute per IP, keyed on IP alone (not
 * IP+path), so it caps a client's total request volume across the whole API.
 * /health and / are exempt so orchestrator probes are never throttled.
 */
export function globalRateLimit(opts: RateLimitOpts = { windowMs: 60_000, max: 100 }) {
  return async (c: Context, next: Next) => {
    if (GLOBAL_LIMIT_EXEMPT_PATHS.has(c.req.path)) {
      await next()
      return
    }

    const key = `global:${clientIp(c)}`
    const { limited, retryAfter } = consume(key, opts, c)

    if (limited) {
      c.header('Retry-After', String(retryAfter))
      return c.json({ error: 'Terlalu banyak permintaan. Coba lagi nanti.' }, 429)
    }

    await next()
  }
}

const MAX_LOGIN_FAILURES = 5
const LOCKOUT_MS = 15 * 60 * 1000

export function checkLoginLockout() {
  return async (c: Context, next: Next) => {
    // Read the body once; Hono caches it so the route can read it again.
    const body = await c.req.json().catch(() => ({} as Record<string, unknown>))
    const email = String((body as { email?: unknown }).email ?? '').toLowerCase()

    if (!email) {
      await next()
      return
    }

    const row = await db.query.loginAttempts.findFirst({
      where: eq(loginAttempts.email, email),
    })

    if (
      row &&
      row.count >= MAX_LOGIN_FAILURES &&
      row.lockedUntil &&
      Date.now() < row.lockedUntil.getTime()
    ) {
      const retryAfter = Math.ceil((row.lockedUntil.getTime() - Date.now()) / 1000)
      c.header('Retry-After', String(retryAfter))
      return c.json(
        { error: `Terlalu banyak percobaan gagal. Coba lagi dalam ${Math.ceil(retryAfter / 60)} menit.` },
        429,
      )
    }

    await next()
  }
}

export async function recordLoginFailure(email: string) {
  const key = email.toLowerCase()
  const now = new Date()
  const lockedUntil = new Date(now.getTime() + LOCKOUT_MS)

  // Upsert: if a lock is still active, increment; otherwise reset the counter.
  await db
    .insert(loginAttempts)
    .values({ email: key, count: 1, lockedUntil, updatedAt: now })
    .onConflictDoUpdate({
      target: loginAttempts.email,
      set: {
        count: sql`CASE WHEN ${loginAttempts.lockedUntil} IS NOT NULL AND ${loginAttempts.lockedUntil} > ${now.toISOString()} THEN ${loginAttempts.count} + 1 ELSE 1 END`,
        lockedUntil: sql`CASE WHEN ${loginAttempts.lockedUntil} IS NOT NULL AND ${loginAttempts.lockedUntil} > ${now.toISOString()} THEN ${loginAttempts.lockedUntil} ELSE ${lockedUntil.toISOString()} END`,
        updatedAt: now,
      },
    })
}

export async function clearLoginFailure(email: string) {
  await db.delete(loginAttempts).where(eq(loginAttempts.email, email.toLowerCase()))
}
