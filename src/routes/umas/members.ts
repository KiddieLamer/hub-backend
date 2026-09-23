import { Hono } from 'hono'
import { z } from 'zod'
import { eq, and } from 'drizzle-orm'
import { db } from '../../db'
import { tenantMembers, users, tenants, positions, roles, userRoles, rolePermissions, permissions } from '../../db/schema'
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
  jobTitle: z.string().max(255).nullish(),
  positionId: z.string().uuid().nullish(),
})

const updateMemberRoleSchema = z.object({
  role: z.enum(['owner', 'admin', 'member']),
})

const updateMemberPositionSchema = z.object({
  positionId: z.string().uuid().nullable(),
})

// Idempotent helper: grant an RBAC role to a user within one tenant.
// Only applies when the role itself belongs to that tenant.
async function grantTenantRole(userId: string, roleId: string, tenantId: string) {
  const role = await db.query.roles.findFirst({
    where: and(eq(roles.id, roleId), eq(roles.tenantId, tenantId)),
  })
  if (!role) return

  const existing = await db.query.userRoles.findFirst({
    where: and(
      eq(userRoles.userId, userId),
      eq(userRoles.roleId, roleId),
      eq(userRoles.tenantId, tenantId),
    ),
  })
  if (!existing) {
    await db.insert(userRoles).values({ userId, roleId, tenantId })
  }
}

membersRouter.get('/', async (c) => {
  const tenant = c.get('tenant')

  const data = await db
    .select({
      id: tenantMembers.id,
      userId: tenantMembers.userId,
      role: tenantMembers.role,
      jobTitle: tenantMembers.jobTitle,
      positionId: tenantMembers.positionId,
      positionName: positions.name,
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
    .leftJoin(positions, eq(tenantMembers.positionId, positions.id))
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

  // Tenant-scoped permissions for UI gating (menus, buttons).
  const permRows = await db
    .select({ permissionName: permissions.name })
    .from(userRoles)
    .innerJoin(roles, eq(userRoles.roleId, roles.id))
    .innerJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
    .innerJoin(permissions, eq(rolePermissions.permissionId, permissions.id))
    .where(and(eq(userRoles.userId, authUser.id), eq(userRoles.tenantId, tenant.tenantId)))

  return c.json({
    membership,
    permissions: [...new Set(permRows.map((p) => p.permissionName))],
  })
})

membersRouter.post('/', async (c) => {
  const tenant = c.get('tenant')
  if (!['owner', 'admin', 'hub-admin'].includes(tenant.tenantRole)) {
    return c.json({ error: 'Insufficient permissions' }, 403)
  }

  const tenantExists = await db.query.tenants.findFirst({
    where: eq(tenants.id, tenant.tenantId),
  })
  if (!tenantExists) {
    return c.json({ error: 'Tenant not found' }, 404)
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

  let position: { id: string; defaultRoleId: string | null } | undefined
  if (body.positionId) {
    const found = await db.query.positions.findFirst({
      where: and(eq(positions.id, body.positionId), eq(positions.tenantId, tenant.tenantId)),
    })
    if (!found) {
      return c.json({ error: 'Position not found in this tenant' }, 404)
    }
    position = found
  }

  const [member] = await db
    .insert(tenantMembers)
    .values({
      userId: body.userId,
      tenantId: tenant.tenantId,
      role: body.role,
      jobTitle: body.jobTitle ?? null,
      positionId: position?.id ?? null,
    })
    .returning()

  // Auto-grant the position's default RBAC role, if any.
  if (position?.defaultRoleId) {
    await grantTenantRole(body.userId, position.defaultRoleId, tenant.tenantId)
  }

  return c.json({ member }, 201)
})

membersRouter.patch('/:id/role', async (c) => {
  const tenant = c.get('tenant')
  if (!['owner', 'admin', 'hub-admin'].includes(tenant.tenantRole)) {
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
  if (!['owner', 'admin', 'hub-admin'].includes(tenant.tenantRole)) {
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

membersRouter.patch('/:id/position', async (c) => {
  const tenant = c.get('tenant')
  if (!['owner', 'admin', 'hub-admin'].includes(tenant.tenantRole)) {
    return c.json({ error: 'Insufficient permissions' }, 403)
  }
  const { id } = c.req.param()
  const body = updateMemberPositionSchema.parse(await c.req.json())

  const member = await db.query.tenantMembers.findFirst({
    where: and(eq(tenantMembers.id, id), eq(tenantMembers.tenantId, tenant.tenantId)),
  })
  if (!member) {
    return c.json({ error: 'Member not found' }, 404)
  }

  let position: { id: string; defaultRoleId: string | null } | null = null
  if (body.positionId) {
    const found = await db.query.positions.findFirst({
      where: and(eq(positions.id, body.positionId), eq(positions.tenantId, tenant.tenantId)),
    })
    if (!found) {
      return c.json({ error: 'Position not found in this tenant' }, 404)
    }
    position = found
  }

  const [updated] = await db
    .update(tenantMembers)
    .set({ positionId: position?.id ?? null })
    .where(and(eq(tenantMembers.id, id), eq(tenantMembers.tenantId, tenant.tenantId)))
    .returning()

  // Auto-grant the position's default RBAC role, if any.
  if (position?.defaultRoleId) {
    await grantTenantRole(member.userId, position.defaultRoleId, tenant.tenantId)
  }

  return c.json({ member: updated })
})

membersRouter.delete('/:id', async (c) => {
  const tenant = c.get('tenant')
  if (!['owner', 'admin', 'hub-admin'].includes(tenant.tenantRole)) {
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

  // Revoke this tenant's RBAC roles together with the membership.
  await db.delete(userRoles).where(and(
    eq(userRoles.userId, member.userId),
    eq(userRoles.tenantId, tenant.tenantId),
  ))
  await db.delete(tenantMembers).where(eq(tenantMembers.id, id))

  return c.json({ message: 'Member removed' })
})

export default membersRouter
