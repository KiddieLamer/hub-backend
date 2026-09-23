import { Hono } from 'hono'
import { z } from 'zod'
import { eq, and } from 'drizzle-orm'
import { db } from '../../db'
import { users, tenants, tenantMembers, refreshTokens } from '../../db/schema'
import { hashPassword, comparePassword } from '../../lib/password'
import { signAccessToken, signRefreshToken, verifyRefreshToken } from '../../lib/jwt'
import { env } from '../../config/env'
import { rateLimit, checkLoginLockout, recordLoginFailure, clearLoginFailure } from '../../middleware/rateLimit'

const auth = new Hono()

const registerSchema = z.object({
  fullName: z.string().min(2).max(255),
  email: z.string().email(),
  password: z.string().min(6).max(100),
  phoneNumber: z.string().max(20).optional(),
  tenantName: z.string().min(2).max(255).optional(),
})

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
})

auth.post('/register', rateLimit({ windowMs: 60_000, max: 10 }), async (c) => {
  const body = registerSchema.parse(await c.req.json())

  const existing = await db.query.users.findFirst({
    where: eq(users.email, body.email),
  })

  if (existing) {
    return c.json({ error: 'Email already registered' }, 409)
  }

  const passwordHash = await hashPassword(body.password)

  const [user] = await db
    .insert(users)
    .values({
      email: body.email,
      fullName: body.fullName,
      phoneNumber: body.phoneNumber,
      passwordHash,
    })
    .returning({
      id: users.id,
      email: users.email,
      fullName: users.fullName,
      phoneNumber: users.phoneNumber,
      role: users.role,
      status: users.status,
    })

  if (body.tenantName) {
    const slug = body.tenantName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')

    const dbSchemaName = `tenant_${slug.replace(/-/g, '_')}`

    const [tenant] = await db
      .insert(tenants)
      .values({ name: body.tenantName, slug, dbSchema: dbSchemaName })
      .returning()

    await db.insert(tenantMembers).values({
      userId: user.id,
      tenantId: tenant.id,
      role: 'owner',
    })

    await db.update(users).set({ currentTenantId: tenant.id }).where(eq(users.id, user.id))
  }

  const accessToken = await signAccessToken(user.id)
  const refreshToken = await signRefreshToken(user.id)

  const ip = c.req.header('x-forwarded-for') || c.req.header('x-real-ip') || null
  const userAgent = c.req.header('user-agent') || null

  await db.insert(refreshTokens).values({
    token: refreshToken,
    userId: user.id,
    ip,
    userAgent,
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  })

  return c.json({
    user,
    accessToken,
    refreshToken,
  }, 201)
})

auth.post('/login', rateLimit({ windowMs: 15 * 60_000, max: 30 }), checkLoginLockout(), async (c) => {
  const body = loginSchema.parse(await c.req.json())

  const user = await db.query.users.findFirst({
    where: eq(users.email, body.email),
  })

  if (!user) {
    return c.json({ error: 'Invalid credentials' }, 401)
  }

  if (user.deletedAt) {
    return c.json({ error: 'Account deleted' }, 401)
  }

  if (user.status === 'suspended') {
    return c.json({ error: 'Account suspended' }, 403)
  }

  const valid = await comparePassword(body.password, user.passwordHash)
  if (!valid) {
    recordLoginFailure(body.email)
    return c.json({ error: 'Invalid credentials' }, 401)
  }

  clearLoginFailure(body.email)
  await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id))

  const accessToken = await signAccessToken(user.id)
  const refreshToken = await signRefreshToken(user.id)

  const ip = c.req.header('x-forwarded-for') || c.req.header('x-real-ip') || null
  const userAgent = c.req.header('user-agent') || null

  await db.insert(refreshTokens).values({
    token: refreshToken,
    userId: user.id,
    ip,
    userAgent,
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  })

  return c.json({
    user: {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      phoneNumber: user.phoneNumber,
      avatarUrl: user.avatarUrl,
      role: user.role,
      status: user.status,
      currentTenantId: user.currentTenantId,
    },
    accessToken,
    refreshToken,
  })
})

const refreshSchema = z.object({
  refreshToken: z.string().min(1),
})

auth.post('/refresh', async (c) => {
  const body = refreshSchema.parse(await c.req.json())
  const refreshToken = body.refreshToken

  if (!refreshToken) {
    return c.json({ error: 'Refresh token required' }, 400)
  }

  try {
    const payload = await verifyRefreshToken(refreshToken)
    const userId = payload.sub

    if (!userId) {
      return c.json({ error: 'Invalid refresh token' }, 401)
    }

    const storedToken = await db.query.refreshTokens.findFirst({
      where: and(
        eq(refreshTokens.token, refreshToken),
        eq(refreshTokens.userId, userId),
      ),
    })

    if (!storedToken || storedToken.revokedAt) {
      return c.json({ error: 'Refresh token revoked' }, 401)
    }

    if (new Date() > storedToken.expiresAt) {
      return c.json({ error: 'Refresh token expired' }, 401)
    }

    await db.update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(eq(refreshTokens.id, storedToken.id))

    const newAccessToken = await signAccessToken(userId)
    const newRefreshToken = await signRefreshToken(userId)

    const ip = c.req.header('x-forwarded-for') || c.req.header('x-real-ip') || null
    const userAgent = c.req.header('user-agent') || null

    await db.insert(refreshTokens).values({
      token: newRefreshToken,
      userId,
      ip,
      userAgent,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    })

    return c.json({ accessToken: newAccessToken, refreshToken: newRefreshToken })
  } catch {
    return c.json({ error: 'Invalid refresh token' }, 401)
  }
})

auth.post('/logout', async (c) => {
  const header = c.req.header('Authorization')
  if (header?.startsWith('Bearer ')) {
    const token = header.slice(7)
    try {
      const { payload } = await import('jose').then(m => m.jwtVerify(token, new TextEncoder().encode(env.JWT_SECRET)))
      if (payload.sub) {
        await db.update(refreshTokens)
          .set({ revokedAt: new Date() })
          .where(eq(refreshTokens.userId, payload.sub))
      }
    } catch {}
  }

  return c.json({ message: 'Logged out' })
})

export default auth
