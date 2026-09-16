import { Hono } from 'hono'
import { z } from 'zod'
import { eq, and } from 'drizzle-orm'
import { db } from '../../db'
import { tenantMembers, users } from '../../db/schema'
import { authMiddleware, type Variables as AuthVariables } from '../../middleware/auth'
import { tenantMiddleware, type TenantVariables } from '../../middleware/tenant'
import { requirePermission } from '../../middleware/rbac'

type Variables = AuthVariables & TenantVariables

const membersRouter = new Hono<{ Variables: Variables }>()

membersRouter.use('*', authMiddleware)
membersRouter.use('*', tenantMiddleware)

const updateJobTitleSchema = z.object({
  jobTitle: z.string().max(255).nullable(),
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

membersRouter.patch('/:id/job-title', requirePermission('members:manage'), async (c) => {
  const tenant = c.get('tenant')
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

membersRouter.delete('/:id', requirePermission('members:manage'), async (c) => {
  const tenant = c.get('tenant')
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
