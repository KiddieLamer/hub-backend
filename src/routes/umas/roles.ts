import { Hono } from 'hono'
import { db } from '../../db'
import { roles, rolePermissions, permissions } from '../../db/schema'
import { authMiddleware } from '../../middleware/auth'
import { requirePlatformOwner } from '../../middleware/platform'
import { z } from 'zod'
import { sql } from 'drizzle-orm'

const rolesRouter = new Hono()

rolesRouter.use('*', authMiddleware)

rolesRouter.get('/', async (c) => {
  const tenantId = c.req.header('X-Tenant-ID')
  if (!tenantId) return c.json({ error: 'X-Tenant-ID header required' }, 400)

  const tenantRoles = await db.query.roles.findMany({
    where: (roles, { eq }) => eq(roles.tenantId, tenantId),
    with: {
      rolePermissions: {
        with: { permission: true },
      },
    },
  })
  return c.json({ roles: tenantRoles })
})

rolesRouter.post('/', requirePlatformOwner, async (c) => {
  const tenantId = c.req.header('X-Tenant-ID')
  if (!tenantId) return c.json({ error: 'X-Tenant-ID header required' }, 400)

  const body = z.object({
    name: z.string().min(1).max(100),
    description: z.string().max(500).optional(),
    permissionIds: z.array(z.string().uuid()).optional(),
  }).parse(await c.req.json())

  const existing = await db.query.roles.findFirst({
    where: (roles, { eq, and }) => and(eq(roles.tenantId, tenantId), eq(roles.name, body.name)),
  })
  if (existing) return c.json({ error: 'Role name already exists in this tenant' }, 409)

  const [role] = await db.insert(roles).values({
    tenantId,
    name: body.name,
    description: body.description,
  }).returning()

  if (body.permissionIds && body.permissionIds.length > 0) {
    await db.insert(rolePermissions).values(
      body.permissionIds.map((pid) => ({ roleId: role.id, permissionId: pid }))
    )
  }

  return c.json({ role }, 201)
})

rolesRouter.delete('/:id', requirePlatformOwner, async (c) => {
  const id = c.req.param('id')
  const [role] = await db.execute(sql`SELECT * FROM roles WHERE id = ${id}`)
  if (!role) return c.json({ error: 'Role not found' }, 404)

  if ((role as any).is_system === 'true') {
    return c.json({ error: 'Cannot delete system role' }, 400)
  }

  await db.execute(sql`DELETE FROM role_permissions WHERE role_id = ${id}`)
  await db.execute(sql`DELETE FROM user_roles WHERE role_id = ${id}`)
  await db.execute(sql`DELETE FROM roles WHERE id = ${id}`)
  return c.json({ success: true })
})

rolesRouter.get('/permissions', async (c) => {
  const allPermissions = await db.query.permissions.findMany()
  return c.json({ permissions: allPermissions })
})

export default rolesRouter
