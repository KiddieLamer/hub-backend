import { Context, Next } from 'hono'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'

interface RateLimitEntry {
  count: number
  resetAt: number
}

interface RateLimitOpts {
  windowMs: number
  max: number
}

const STORE_PATH = join(process.cwd(), 'rate-limit-store.json')

const store = new Map<string, RateLimitEntry>()

function loadStore() {
  try {
    if (existsSync(STORE_PATH)) {
      const data = JSON.parse(readFileSync(STORE_PATH, 'utf-8'))
      for (const [key, entry] of Object.entries(data)) {
        store.set(key, entry as RateLimitEntry)
      }
    }
  } catch {}
}

function saveStore() {
  try {
    const obj: Record<string, RateLimitEntry> = {}
    for (const [key, entry] of store) {
      obj[key] = entry
    }
    writeFileSync(STORE_PATH, JSON.stringify(obj))
  } catch {}
}

loadStore()

function cleanup() {
  const now = Date.now()
  for (const [key, entry] of store) {
    if (now > entry.resetAt) store.delete(key)
  }
}
setInterval(() => { cleanup(); saveStore() }, 60_000)

process.on('SIGTERM', saveStore)
process.on('SIGINT', saveStore)

export function rateLimit(opts: RateLimitOpts) {
  return async (c: Context, next: Next) => {
    const ip = c.req.header('x-forwarded-for') || c.req.header('x-real-ip') || 'unknown'
    const key = `${ip}:${c.req.path}`
    const now = Date.now()

    let entry = store.get(key)
    if (!entry || now > entry.resetAt) {
      entry = { count: 0, resetAt: now + opts.windowMs }
      store.set(key, entry)
    }

    entry.count++

    c.header('X-RateLimit-Limit', String(opts.max))
    c.header('X-RateLimit-Remaining', String(Math.max(0, opts.max - entry.count)))
    c.header('X-RateLimit-Reset', String(Math.ceil(entry.resetAt / 1000)))

    if (entry.count > opts.max) {
      const retryAfter = Math.ceil((entry.resetAt - now) / 1000)
      c.header('Retry-After', String(retryAfter))
      return c.json({ error: 'Terlalu banyak percobaan. Coba lagi nanti.' }, 429)
    }

    await next()
  }
}

const loginAttempts = new Map<string, { count: number; lockedUntil: number }>()

export function checkLoginLockout() {
  return async (c: Context, next: Next) => {
    const body = await c.req.json()
    const email = (body.email || '').toLowerCase()
    const key = `lock:${email}`

    const entry = loginAttempts.get(key)
    if (entry && Date.now() < entry.lockedUntil) {
      const retryAfter = Math.ceil((entry.lockedUntil - Date.now()) / 1000)
      c.header('Retry-After', String(retryAfter))
      return c.json({ error: `Terlalu banyak percobaan gagal. Coba lagi dalam ${Math.ceil(retryAfter / 60)} menit.` }, 429)
    }

    await next()
  }
}

export function recordLoginFailure(email: string) {
  const key = `lock:${email.toLowerCase()}`
  const entry = loginAttempts.get(key)
  const now = Date.now()

  if (!entry || now > entry.lockedUntil) {
    loginAttempts.set(key, { count: 1, lockedUntil: now + 15 * 60 * 1000 })
  } else {
    entry.count++
    if (entry.count >= 5) {
      entry.lockedUntil = now + 15 * 60 * 1000
    }
  }
}

export function clearLoginFailure(email: string) {
  loginAttempts.delete(`lock:${email.toLowerCase()}`)
}
