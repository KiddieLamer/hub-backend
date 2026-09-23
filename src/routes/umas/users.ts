import { Hono } from 'hono'
import { z } from 'zod'
import { eq, or, ilike, and, isNull, inArray, count } from 'drizzle-orm'
import { db } from '../../db'
import { users, tenantMembers, refreshTokens, tenants } from '../../db/schema'
import { authMiddleware, type Variables } from '../../middleware/auth'
import { hashPassword } from '../../lib/password'

const usersRouter = new Hono<{ Variables: Variables }>()
usersRouter.use('*', authMiddleware)

const updateProfileSchema = z.object({
  fullName: z.string().min(2).max(255).optional(),
  email: z.string().email().optional(),
  phoneNumber: z.string().max(20).optional(),
  avatarUrl: z.string().url().optional(),
  jobTitle: z.string().max(100).optional(),
  department: z.string().max(100).optional(),
  employeeId: z.string().max(50).optional(),
})

const changePasswordSchema = z.object({
  currentPassword: z.string(),
  newPassword: z.string().min(6).max(100),
})

const createUserSchema = z.object({
  fullName: z.string().min(2).max(255),
  email: z.string().email(),
  password: z.string().min(6).max(100),
  phoneNumber: z.string().max(20).optional(),
  dateOfBirth: z.string().optional(),
  ktpNumber: z.string().max(30).optional(),
  address: z.string().optional(),
  employeeId: z.string().max(50).optional(),
  jobTitle: z.string().max(100).optional(),
  department: z.string().max(100).optional(),
  role: z.enum(['admin', 'user', 'viewer']).default('user'),
  status: z.enum(['active', 'inactive', 'suspended']).default('active'),
  tenantId: z.string().uuid().optional(),
  memberRole: z.enum(['owner', 'admin', 'member']).default('member'),
})

async function canManageTarget(
  caller: { id: string; platformRole: string | null },
  targetId: string,
): Promise<boolean> {
  if (targetId === caller.id) return true
  if (caller.platformRole === 'hub-admin') return true

  const callerMemberships = await db.query.tenantMembers.findMany({
    where: eq(tenantMembers.userId, caller.id),
  })
  const adminTenantIds = new Set(
    callerMemberships
      .filter((m) => ['owner', 'admin'].includes(m.role))
      .map((m) => m.tenantId),
  )
  if (adminTenantIds.size === 0) return false

  const targetMemberships = await db.query.tenantMembers.findMany({
    where: eq(tenantMembers.userId, targetId),
  })
  return targetMemberships.some((m) => adminTenantIds.has(m.tenantId))
}

usersRouter.get('/', async (c) => {
  const authUser = c.get('user')
  const { search, status } = c.req.query()

  const isHubAdmin = authUser.platformRole === 'hub-admin'
  let adminTenantIds: string[] = []

  if (!isHubAdmin) {
    const callerMemberships = await db.query.tenantMembers.findMany({
      where: eq(tenantMembers.userId, authUser.id),
    })
    adminTenantIds = callerMemberships
      .filter((m) => ['owner', 'admin'].includes(m.role))
      .map((m) => m.tenantId)
    if (adminTenantIds.length === 0) {
      return c.json({ error: 'Insufficient permissions' }, 403)
    }
  }

  const rawLimit = Number.parseInt(String(c.req.query('limit') ?? ''), 10)
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 100) : 50

  const listColumns = {
    id: true, email: true, fullName: true, phoneNumber: true, avatarUrl: true,
    employeeId: true, jobTitle: true, department: true, role: true, status: true,
    createdAt: true,
  }

  const searchFilter = search
    ? or(
        ilike(users.fullName, `%${search.replace(/[%_]/g, '\\$&')}%`),
        ilike(users.email, `%${search.replace(/[%_]/g, '\\$&')}%`),
        ilike(users.employeeId, `%${search.replace(/[%_]/g, '\\$&')}%`),
      )
    : undefined

  const conditions = [isNull(users.deletedAt)]

  if (status) {
    conditions.push(eq(users.status, status))
  }

  if (search) {
    conditions.push(searchFilter!)
  }

  // Tenant admins/managers only ever see users from tenants they manage,
  // even when searching. Otherwise they could enumerate other companies'
  // users (names, emails, phones) via the search box.
  if (!isHubAdmin) {
    const memberRows = await db
      .select({ userId: tenantMembers.userId })
      .from(tenantMembers)
      .where(inArray(tenantMembers.tenantId, adminTenantIds))
    const memberUserIds = [...new Set(memberRows.map((r) => r.userId))]
    if (memberUserIds.length === 0) {
      return c.json({ users: [], total: 0 })
    }
    conditions.push(inArray(users.id, memberUserIds))
  }

  const where = and(...conditions)

  const [data, totalRows] = await Promise.all([
    db.query.users.findMany({
      where,
      columns: listColumns,
      orderBy: (users, { desc }) => [desc(users.createdAt)],
      limit,
    }),
    db.select({ total: count() }).from(users).where(where),
  ])

  return c.json({ users: data, total: totalRows[0]?.total ?? 0 })
})

usersRouter.get('/me', async (c) => {
  const authUser = c.get('user')
  const user = await db.query.users.findFirst({
    where: eq(users.id, authUser.id),
    columns: {
      id: true,
      email: true,
      fullName: true,
      phoneNumber: true,
      avatarUrl: true,
      role: true,
      platformRole: true,
      status: true,
      jobTitle: true,
      department: true,
      employeeId: true,
      currentTenantId: true,
      lastLoginAt: true,
      is2faEnabled: true,
      emailVerifiedAt: true,
      phoneVerifiedAt: true,
      createdAt: true,
    },
  })

  if (!user) {
    return c.json({ error: 'User not found' }, 404)
  }

  return c.json({ user })
})

usersRouter.patch('/me', async (c) => {
  const authUser = c.get('user')
  const body = updateProfileSchema.parse(await c.req.json())

  const [updated] = await db
    .update(users)
    .set({ ...body, updatedAt: new Date() })
    .where(eq(users.id, authUser.id))
    .returning({
      id: users.id,
      email: users.email,
      fullName: users.fullName,
      phoneNumber: users.phoneNumber,
      avatarUrl: users.avatarUrl,
      jobTitle: users.jobTitle,
      department: users.department,
      employeeId: users.employeeId,
    })

  return c.json({ user: updated })
})

usersRouter.post('/me/change-password', async (c) => {
  const authUser = c.get('user')
  const body = changePasswordSchema.parse(await c.req.json())

  const user = await db.query.users.findFirst({
    where: eq(users.id, authUser.id),
  })

  if (!user) {
    return c.json({ error: 'User not found' }, 404)
  }

  const valid = await import('../../lib/password').then((m) =>
    m.comparePassword(body.currentPassword, user.passwordHash)
  )

  if (!valid) {
    return c.json({ error: 'Current password is incorrect' }, 401)
  }

  const passwordHash = await hashPassword(body.newPassword)
  await db
    .update(users)
    .set({ passwordHash, updatedAt: new Date() })
    .where(eq(users.id, authUser.id))

  return c.json({ message: 'Password updated' })
})

usersRouter.post('/:id/reset-password', async (c) => {
  const authUser = c.get('user')
  const { id } = c.req.param()
  const body = await c.req.json()

  if (!body.newPassword || body.newPassword.length < 6) {
    return c.json({ error: 'Password must be at least 6 characters' }, 400)
  }

  if (id === authUser.id) {
    return c.json({ error: 'Use change-password to update your own password' }, 403)
  }

  if (!(await canManageTarget(authUser, id))) {
    return c.json({ error: 'Insufficient permissions' }, 403)
  }

  const user = await db.query.users.findFirst({
    where: eq(users.id, id),
  })

  if (!user) {
    return c.json({ error: 'User not found' }, 404)
  }

  const passwordHash = await hashPassword(body.newPassword)
  await db
    .update(users)
    .set({ passwordHash, updatedAt: new Date() })
    .where(eq(users.id, id))

  await db
    .update(refreshTokens)
    .set({ revokedAt: new Date() })
    .where(eq(refreshTokens.userId, id))

  return c.json({ message: 'Password reset successfully' })
})

usersRouter.delete('/me', async (c) => {
  const authUser = c.get('user')

  // Soft delete
  await db
    .update(users)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(eq(users.id, authUser.id))

  return c.json({ message: 'Account deleted' })
})

usersRouter.post('/', async (c) => {
  const authUser = c.get('user')
  const body = createUserSchema.parse(await c.req.json())

  const isHubAdmin = authUser.platformRole === 'hub-admin'
  let adminTenantIds = new Set<string>()

  if (!isHubAdmin) {
    const callerMemberships = await db.query.tenantMembers.findMany({
      where: eq(tenantMembers.userId, authUser.id),
    })
    adminTenantIds = new Set(
      callerMemberships
        .filter((m) => ['owner', 'admin'].includes(m.role))
        .map((m) => m.tenantId),
    )
    if (adminTenantIds.size === 0) {
      return c.json({ error: 'Insufficient permissions' }, 403)
    }
  }

  if (body.role === 'admin' && !isHubAdmin) {
    return c.json({ error: 'Only hub-admin can create admin users' }, 403)
  }

  // Tenant admins create users directly into a tenant they manage.
  // Without this, the new user would be an orphan they cannot see or manage.
  if (!isHubAdmin && !body.tenantId) {
    return c.json({ error: 'tenantId is required' }, 400)
  }

  if (body.tenantId) {
    const tenant = await db.query.tenants.findFirst({
      where: eq(tenants.id, body.tenantId),
    })
    if (!tenant) {
      return c.json({ error: 'Tenant not found' }, 404)
    }

    if (!isHubAdmin && !adminTenantIds.has(body.tenantId)) {
      return c.json({ error: 'Insufficient permissions for this tenant' }, 403)
    }

    if (body.memberRole === 'owner') {
      if (!isHubAdmin) {
        const callerMembership = await db.query.tenantMembers.findFirst({
          where: and(
            eq(tenantMembers.userId, authUser.id),
            eq(tenantMembers.tenantId, body.tenantId),
          ),
        })
        if (callerMembership?.role !== 'owner') {
          return c.json({ error: 'Only owner or hub-admin can assign owner role' }, 403)
        }
      }
    }
  }

  const existing = await db.query.users.findFirst({
    where: eq(users.email, body.email),
  })

  if (existing) {
    return c.json({ error: 'Email sudah terdaftar' }, 409)
  }

  const passwordHash = await hashPassword(body.password)

  let dateOfBirth: Date | undefined
  if (body.dateOfBirth) {
    const parsed = new Date(body.dateOfBirth)
    if (Number.isNaN(parsed.getTime())) {
      return c.json({ error: 'Invalid dateOfBirth' }, 400)
    }
    dateOfBirth = parsed
  }

  const [user] = await db
    .insert(users)
    .values({
      email: body.email,
      fullName: body.fullName,
      passwordHash,
      phoneNumber: body.phoneNumber,
      dateOfBirth,
      ktpNumber: body.ktpNumber,
      address: body.address,
      employeeId: body.employeeId,
      jobTitle: body.jobTitle,
      department: body.department,
      role: body.role,
      status: body.status,
    })
    .returning({
      id: users.id, email: users.email, fullName: users.fullName,
      phoneNumber: users.phoneNumber, employeeId: users.employeeId,
      jobTitle: users.jobTitle, department: users.department,
      role: users.role, status: users.status, createdAt: users.createdAt,
    })

  if (body.tenantId) {
    await db.insert(tenantMembers).values({
      userId: user.id,
      tenantId: body.tenantId,
      role: body.memberRole,
    })
  }

  return c.json({ user }, 201)
})

usersRouter.get('/:id', async (c) => {
  const authUser = c.get('user')
  const { id } = c.req.param()

  if (!(await canManageTarget(authUser, id))) {
    return c.json({ error: 'Insufficient permissions' }, 403)
  }

  const user = await db.query.users.findFirst({
    where: and(eq(users.id, id), isNull(users.deletedAt)),
    columns: {
      id: true, email: true, fullName: true, phoneNumber: true, avatarUrl: true,
      employeeId: true, jobTitle: true, department: true, role: true, status: true,
      dateOfBirth: true, ktpNumber: true, address: true, createdAt: true,
    },
  })

  if (!user) {
    return c.json({ error: 'User not found' }, 404)
  }

  return c.json({ user })
})

usersRouter.patch('/:id', async (c) => {
  const authUser = c.get('user')
  const { id } = c.req.param()

  if (!(await canManageTarget(authUser, id))) {
    return c.json({ error: 'Insufficient permissions' }, 403)
  }

  const body = updateProfileSchema.parse(await c.req.json())

  if (body.email) {
    const taken = await db.query.users.findFirst({
      where: and(eq(users.email, body.email), isNull(users.deletedAt)),
    })
    if (taken && taken.id !== id) {
      return c.json({ error: 'Email sudah terdaftar' }, 409)
    }
  }

  const [updated] = await db
    .update(users)
    .set({ ...body, updatedAt: new Date() })
    .where(and(eq(users.id, id), isNull(users.deletedAt)))
    .returning({
      id: users.id,
      email: users.email,
      fullName: users.fullName,
      phoneNumber: users.phoneNumber,
      avatarUrl: users.avatarUrl,
      employeeId: users.employeeId, jobTitle: users.jobTitle,
      department: users.department, role: users.role, status: users.status,
    })

  if (!updated) {
    return c.json({ error: 'User not found' }, 404)
  }

  return c.json({ user: updated })
})

usersRouter.delete('/:id', async (c) => {
  const authUser = c.get('user')
  const { id } = c.req.param()

  if (id === authUser.id) {
    return c.json({ error: 'Use DELETE /me to delete your own account' }, 403)
  }

  if (!(await canManageTarget(authUser, id))) {
    return c.json({ error: 'Insufficient permissions' }, 403)
  }

  const [updated] = await db
    .update(users)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(users.id, id), isNull(users.deletedAt)))
    .returning({ id: users.id })

  if (!updated) {
    return c.json({ error: 'User not found' }, 404)
  }

  await db
    .update(refreshTokens)
    .set({ revokedAt: new Date() })
    .where(eq(refreshTokens.userId, id))

  return c.json({ message: 'User deleted' })
})

export default usersRouter
