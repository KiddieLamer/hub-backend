import { Hono } from 'hono'
import { db } from '../../db'
import { roles, permissions, rolePermissions, userRoles, tenantMembers, users } from '../../db/schema'
import { authMiddleware, type Variables as AuthVariables } from '../../middleware/auth'
import { requireModuleAccess } from '../../middleware/rbac'
import { tenantMiddleware, type TenantVariables } from '../../middleware/tenant'
import { z } from 'zod'
import { eq, and, inArray, count } from 'drizzle-orm'

type Variables = AuthVariables & TenantVariables

const rolesRouter = new Hono<{ Variables: Variables }>()

rolesRouter.use('*', authMiddleware)
rolesRouter.use('*', tenantMiddleware)
rolesRouter.use('*', requireModuleAccess('roles:read', 'roles:write'))

rolesRouter.get('/', async (c) => {
  const tenant = c.get('tenant')
  const tenantRoles = await db.query.roles.findMany({
    where: eq(roles.tenantId, tenant.tenantId),
  })

  const roleIds = tenantRoles.map((r) => r.id)
  let permMap: Record<string, { id: string; name: string }[]> = {}
  if (roleIds.length > 0) {
    const rows = await db
      .select({
        roleId: rolePermissions.roleId,
        permissionId: permissions.id,
        permissionName: permissions.name,
      })
      .from(rolePermissions)
      .innerJoin(permissions, eq(rolePermissions.permissionId, permissions.id))
      .innerJoin(roles, eq(rolePermissions.roleId, roles.id))
      .where(and(
        eq(roles.tenantId, tenant.tenantId),
        inArray(rolePermissions.roleId, roleIds),
      ))
    for (const row of rows) {
      ;(permMap[row.roleId] ||= []).push({ id: row.permissionId, name: row.permissionName })
    }
  }

  const memberCounts = await db
    .select({ roleId: userRoles.roleId, count: count() })
    .from(userRoles)
    .where(eq(userRoles.tenantId, tenant.tenantId))
    .groupBy(userRoles.roleId)
  const countByRole: Record<string, number> = {}
  for (const row of memberCounts) countByRole[row.roleId] = row.count

  return c.json({
    roles: tenantRoles.map((r) => ({
      ...r,
      permissions: permMap[r.id] || [],
      permissionIds: (permMap[r.id] || []).map((p) => p.id),
      memberCount: countByRole[r.id] || 0,
    })),
  })
})

rolesRouter.post('/', async (c) => {
  const tenant = c.get('tenant')
  const user = c.get('user')

  if (user.platformRole !== 'hub-admin' && !['owner', 'admin'].includes(tenant.tenantRole)) {
    return c.json({ error: 'Insufficient permissions' }, 403)
  }

  const body = z.object({
    name: z.string().min(1).max(100),
    description: z.string().max(500).optional(),
    permissionIds: z.array(z.string().uuid()).optional(),
  }).parse(await c.req.json())

  const existing = await db.query.roles.findFirst({
    where: and(eq(roles.tenantId, tenant.tenantId), eq(roles.name, body.name)),
  })
  if (existing) return c.json({ error: 'Role name already exists in this tenant' }, 409)

  const [role] = await db.insert(roles).values({
    tenantId: tenant.tenantId,
    name: body.name,
    description: body.description,
  }).returning()

  if (body.permissionIds && body.permissionIds.length > 0) {
    const permIds = [...new Set(body.permissionIds)]
    const validPerms = await db.query.permissions.findMany({
      where: (permissions, { inArray }) => inArray(permissions.id, permIds),
      columns: { id: true },
    })
    const validIds = new Set(validPerms.map((p) => p.id))
    const toInsert = permIds
      .filter((pid) => validIds.has(pid))
      .map((pid) => ({ roleId: role.id, permissionId: pid }))
    if (toInsert.length > 0) {
      await db.insert(rolePermissions).values(toInsert)
    }
  }

  return c.json({ role }, 201)
})

rolesRouter.delete('/:id', async (c) => {
  const tenant = c.get('tenant')
  const user = c.get('user')
  const { id } = c.req.param()

  if (user.platformRole !== 'hub-admin' && !['owner', 'admin'].includes(tenant.tenantRole)) {
    return c.json({ error: 'Insufficient permissions' }, 403)
  }

  const role = await db.query.roles.findFirst({
    where: eq(roles.id, id),
  })
  if (!role) {
    return c.json({ error: 'Role not found' }, 404)
  }

  if (role.tenantId !== tenant.tenantId) {
    return c.json({ error: 'Role not found' }, 404)
  }

  if (role.isSystem === 'true') {
    return c.json({ error: 'Cannot delete system role' }, 400)
  }

  await db.delete(rolePermissions).where(eq(rolePermissions.roleId, id))
  await db.delete(userRoles).where(and(eq(userRoles.roleId, id), eq(userRoles.tenantId, tenant.tenantId)))
  await db.delete(roles).where(eq(roles.id, id))

  return c.json({ success: true })
})

rolesRouter.get('/permissions', async (c) => {
  const allPermissions = await db.query.permissions.findMany()
  return c.json({ permissions: allPermissions })
})

// Replace a role's permission set.
rolesRouter.patch('/:id/permissions', async (c) => {
  const tenant = c.get('tenant')
  const user = c.get('user')
  const { id } = c.req.param()

  if (user.platformRole !== 'hub-admin' && !['owner', 'admin'].includes(tenant.tenantRole)) {
    return c.json({ error: 'Insufficient permissions' }, 403)
  }

  const role = await db.query.roles.findFirst({
    where: and(eq(roles.id, id), eq(roles.tenantId, tenant.tenantId)),
  })
  if (!role) {
    return c.json({ error: 'Role not found' }, 404)
  }

  const body = z.object({ permissionIds: z.array(z.string().uuid()) }).parse(await c.req.json())

  const permIds = [...new Set(body.permissionIds)]
  if (permIds.length > 0) {
    const valid = await db.query.permissions.findMany({
      where: (permissions, { inArray }) => inArray(permissions.id, permIds),
      columns: { id: true },
    })
    const validIds = new Set(valid.map((p) => p.id))
    const invalid = permIds.filter((pid) => !validIds.has(pid))
    if (invalid.length > 0) {
      return c.json({ error: 'Unknown permission ids', invalid }, 400)
    }
  }

  await db.delete(rolePermissions).where(eq(rolePermissions.roleId, id))
  if (permIds.length > 0) {
    await db.insert(rolePermissions).values(permIds.map((permissionId) => ({ roleId: id, permissionId })))
  }

  return c.json({ success: true })
})

// List members holding a role in this tenant.
rolesRouter.get('/:id/members', async (c) => {
  const tenant = c.get('tenant')
  const { id } = c.req.param()

  const role = await db.query.roles.findFirst({
    where: and(eq(roles.id, id), eq(roles.tenantId, tenant.tenantId)),
  })
  if (!role) {
    return c.json({ error: 'Role not found' }, 404)
  }

  const rows = await db
    .select({
      userId: userRoles.userId,
      userFullName: users.fullName,
      userEmail: users.email,
    })
    .from(userRoles)
    .innerJoin(users, eq(userRoles.userId, users.id))
    .where(and(eq(userRoles.roleId, id), eq(userRoles.tenantId, tenant.tenantId)))

  return c.json({ members: rows })
})

// Assign an RBAC role to a tenant member (tenant-scoped).
rolesRouter.post('/:id/assign', async (c) => {
  const tenant = c.get('tenant')
  const user = c.get('user')
  const { id } = c.req.param()

  if (user.platformRole !== 'hub-admin' && !['owner', 'admin'].includes(tenant.tenantRole)) {
    return c.json({ error: 'Insufficient permissions' }, 403)
  }

  const role = await db.query.roles.findFirst({
    where: and(eq(roles.id, id), eq(roles.tenantId, tenant.tenantId)),
  })
  if (!role) {
    return c.json({ error: 'Role not found' }, 404)
  }

  const body = z.object({ userId: z.string().uuid() }).parse(await c.req.json())

  const target = await db.query.users.findFirst({ where: eq(users.id, body.userId) })
  if (!target) {
    return c.json({ error: 'User not found' }, 404)
  }

  const membership = await db.query.tenantMembers.findFirst({
    where: and(eq(tenantMembers.userId, body.userId), eq(tenantMembers.tenantId, tenant.tenantId)),
  })
  if (!membership) {
    return c.json({ error: 'User is not a member of this tenant' }, 400)
  }

  const existing = await db.query.userRoles.findFirst({
    where: and(
      eq(userRoles.userId, body.userId),
      eq(userRoles.roleId, id),
      eq(userRoles.tenantId, tenant.tenantId),
    ),
  })
  if (existing) {
    return c.json({ userRole: existing })
  }

  const [userRole] = await db.insert(userRoles).values({
    userId: body.userId,
    roleId: id,
    tenantId: tenant.tenantId,
  }).returning()

  return c.json({ userRole }, 201)
})

// Remove an RBAC role from a tenant member.
rolesRouter.delete('/:id/assign/:userId', async (c) => {
  const tenant = c.get('tenant')
  const user = c.get('user')
  const { id, userId } = c.req.param()

  if (user.platformRole !== 'hub-admin' && !['owner', 'admin'].includes(tenant.tenantRole)) {
    return c.json({ error: 'Insufficient permissions' }, 403)
  }

  await db.delete(userRoles).where(and(
    eq(userRoles.userId, userId),
    eq(userRoles.roleId, id),
    eq(userRoles.tenantId, tenant.tenantId),
  ))

  return c.json({ success: true })
})

export default rolesRouter
