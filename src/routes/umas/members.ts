import { Hono } from 'hono'
import { z } from 'zod'
import { eq, and } from 'drizzle-orm'
import { db } from '../../db'
import { tenantMembers, users } from '../../db/schema'
import { authMiddleware, type Variables as AuthVariables } from '../../middleware/auth'
import { tenantMiddleware, type TenantVariables } from '../../middleware/tenant'

type Variables = AuthVariables & TenantVariables

const membersRouter = new Hono<{ Variables: Variables }>()

membersRouter.use('*', authMiddleware)
membersRouter.use('*', tenantMiddleware)

const updateJobTitleSchema = z.object({
  jobTitle: z.string().max(255).nullable(),
})

const addMemberSchema = z.object({
  userId: z.string().uuid(),
  role: z.enum(['owner', 'admin', 'member']).default('member'),
})

const updateMemberRoleSchema = z.object({
  role: z.enum(['owner', 'admin', 'member']),
})

membersRouter.get('/', async (c) => {
  const tenant = c.get('tenant')

  const data = await db
    .select({
      id: tenantMembers.id,
      userId: tenantMembers.userId,
      role: tenantMembers.role,
      jobTitle: tenantMembers.jobTitle,
      createdAt: tenantMembers.createdAt,
      userFullName: users.fullName,
      userEmail: users.email,
      userAvatarUrl: users.avatarUrl,
      userPhoneNumber: users.phoneNumber,
      userDepartment: users.department,
      userStatus: users.status,
    })
    .from(tenantMembers)
    .innerJoin(users, eq(tenantMembers.userId, users.id))
    .where(eq(tenantMembers.tenantId, tenant.tenantId))

  return c.json({ members: data })
})

membersRouter.get('/me', async (c) => {
  const tenant = c.get('tenant')
  const authUser = c.get('user')

  const membership = await db.query.tenantMembers.findFirst({
    where: and(
      eq(tenantMembers.userId, authUser.id),
      eq(tenantMembers.tenantId, tenant.tenantId)
    ),
  })

  if (!membership) {
    return c.json({ error: 'Not a member of this tenant' }, 404)
  }

  return c.json({ membership })
})

membersRouter.post('/', async (c) => {
  const tenant = c.get('tenant')
  if (!['owner', 'admin'].includes(tenant.tenantRole)) {
    return c.json({ error: 'Insufficient permissions' }, 403)
  }
  const body = addMemberSchema.parse(await c.req.json())

  const user = await db.query.users.findFirst({
    where: eq(users.id, body.userId),
  })
  if (!user) {
    return c.json({ error: 'User not found' }, 404)
  }

  const existing = await db.query.tenantMembers.findFirst({
    where: and(
      eq(tenantMembers.userId, body.userId),
      eq(tenantMembers.tenantId, tenant.tenantId),
    ),
  })
  if (existing) {
    return c.json({ error: 'User is already a member of this tenant' }, 409)
  }

  const [member] = await db
    .insert(tenantMembers)
    .values({
      userId: body.userId,
      tenantId: tenant.tenantId,
      role: body.role,
    })
    .returning()

  return c.json({ member }, 201)
})

membersRouter.patch('/:id/role', async (c) => {
  const tenant = c.get('tenant')
  if (!['owner', 'admin'].includes(tenant.tenantRole)) {
    return c.json({ error: 'Insufficient permissions' }, 403)
  }
  const { id } = c.req.param()
  const body = updateMemberRoleSchema.parse(await c.req.json())

  const member = await db.query.tenantMembers.findFirst({
    where: and(eq(tenantMembers.id, id), eq(tenantMembers.tenantId, tenant.tenantId)),
  })
  if (!member) {
    return c.json({ error: 'Member not found' }, 404)
  }

  const [updated] = await db
    .update(tenantMembers)
    .set({ role: body.role })
    .where(and(eq(tenantMembers.id, id), eq(tenantMembers.tenantId, tenant.tenantId)))
    .returning()

  return c.json({ member: updated })
})

membersRouter.patch('/:id/job-title', async (c) => {
  const tenant = c.get('tenant')
  if (!['owner', 'admin'].includes(tenant.tenantRole)) {
    return c.json({ error: 'Insufficient permissions' }, 403)
  }
  const { id } = c.req.param()
  const body = updateJobTitleSchema.parse(await c.req.json())

  const [updated] = await db
    .update(tenantMembers)
    .set({ jobTitle: body.jobTitle })
    .where(and(eq(tenantMembers.id, id), eq(tenantMembers.tenantId, tenant.tenantId)))
    .returning()

  if (!updated) {
    return c.json({ error: 'Member not found' }, 404)
  }

  return c.json({ member: updated })
})

membersRouter.delete('/:id', async (c) => {
  const tenant = c.get('tenant')
  if (!['owner', 'admin'].includes(tenant.tenantRole)) {
    return c.json({ error: 'Insufficient permissions' }, 403)
  }
  const { id } = c.req.param()

  const member = await db.query.tenantMembers.findFirst({
    where: and(eq(tenantMembers.id, id), eq(tenantMembers.tenantId, tenant.tenantId)),
  })

  if (!member) {
    return c.json({ error: 'Member not found' }, 404)
  }

  if (member.role === 'owner') {
    return c.json({ error: 'Cannot remove owner' }, 403)
  }

  await db.delete(tenantMembers).where(eq(tenantMembers.id, id))

  return c.json({ message: 'Member removed' })
})

export default membersRouter
