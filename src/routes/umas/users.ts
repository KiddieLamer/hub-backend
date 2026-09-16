import { Hono } from 'hono'
import { z } from 'zod'
import { eq, or, ilike, and, isNull } from 'drizzle-orm'
import { db } from '../../db'
import { users, tenantMembers } from '../../db/schema'
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

usersRouter.get('/', async (c) => {
  const { search, status } = c.req.query()

  let data

  if (search) {
    data = await db.query.users.findMany({
      where: and(
        isNull(users.deletedAt),
        or(
          ilike(users.fullName, `%${search}%`),
          ilike(users.email, `%${search}%`),
          ilike(users.employeeId, `%${search}%`)
        )
      ),
      columns: {
        id: true, email: true, fullName: true, phoneNumber: true, avatarUrl: true,
        employeeId: true, jobTitle: true, department: true, role: true, status: true,
        dateOfBirth: true, ktpNumber: true, address: true, createdAt: true,
      },
      orderBy: (users, { desc }) => [desc(users.createdAt)],
    })
  } else if (status) {
    data = await db.query.users.findMany({
      where: and(eq(users.status, status), isNull(users.deletedAt)),
      columns: {
        id: true, email: true, fullName: true, phoneNumber: true, avatarUrl: true,
        employeeId: true, jobTitle: true, department: true, role: true, status: true,
        dateOfBirth: true, ktpNumber: true, address: true, createdAt: true,
      },
      orderBy: (users, { desc }) => [desc(users.createdAt)],
    })
  } else {
    data = await db.query.users.findMany({
      where: isNull(users.deletedAt),
      columns: {
        id: true, email: true, fullName: true, phoneNumber: true, avatarUrl: true,
        employeeId: true, jobTitle: true, department: true, role: true, status: true,
        dateOfBirth: true, ktpNumber: true, address: true, createdAt: true,
      },
      orderBy: (users, { desc }) => [desc(users.createdAt)],
    })
  }

  return c.json({ users: data, total: data.length })
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
  const body = createUserSchema.parse(await c.req.json())

  const existing = await db.query.users.findFirst({
    where: eq(users.email, body.email),
  })

  if (existing) {
    return c.json({ error: 'Email sudah terdaftar' }, 409)
  }

  const passwordHash = await hashPassword(body.password)

  const [user] = await db
    .insert(users)
    .values({
      email: body.email,
      fullName: body.fullName,
      passwordHash,
      phoneNumber: body.phoneNumber,
      dateOfBirth: body.dateOfBirth ? new Date(body.dateOfBirth) : undefined,
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
  const { id } = c.req.param()
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
  const { id } = c.req.param()
  const body = updateProfileSchema.parse(await c.req.json())

  const [updated] = await db
    .update(users)
    .set({ ...body, updatedAt: new Date() })
    .where(and(eq(users.id, id), isNull(users.deletedAt)))
    .returning({
      id: users.id, email: users.email, fullName: users.fullName,
      phoneNumber: users.phoneNumber, avatarUrl: users.avatarUrl,
      employeeId: users.employeeId, jobTitle: users.jobTitle,
      department: users.department, role: users.role, status: users.status,
    })

  if (!updated) {
    return c.json({ error: 'User not found' }, 404)
  }

  return c.json({ user: updated })
})

usersRouter.delete('/:id', async (c) => {
  const { id } = c.req.param()

  const [updated] = await db
    .update(users)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(users.id, id), isNull(users.deletedAt)))
    .returning({ id: users.id })

  if (!updated) {
    return c.json({ error: 'User not found' }, 404)
  }

  return c.json({ message: 'User deleted' })
})

export default usersRouter
