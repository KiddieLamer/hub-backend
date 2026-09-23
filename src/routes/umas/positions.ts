import { Hono } from 'hono'
import { z } from 'zod'
import { eq, and, desc, asc } from 'drizzle-orm'
import { db } from '../../db'
import { positions, roles, tenantMembers } from '../../db/schema'
import { authMiddleware, type Variables as AuthVariables } from '../../middleware/auth'
import { requireModuleAccess } from '../../middleware/rbac'
import { tenantMiddleware, type TenantVariables } from '../../middleware/tenant'

type Variables = AuthVariables & TenantVariables

const positionsRouter = new Hono<{ Variables: Variables }>()

positionsRouter.use('*', authMiddleware)
positionsRouter.use('*', tenantMiddleware)
positionsRouter.use('*', requireModuleAccess('roles:read', 'roles:write'))

function canManage(tenantRole: string, platformRole: string | null) {
  return platformRole === 'hub-admin' || ['owner', 'admin'].includes(tenantRole)
}

const positionSchema = z.object({
  name: z.string().min(2).max(100),
  level: z.number().int().min(0).max(1000).optional(),
  parentId: z.string().uuid().nullable().optional(),
  defaultRoleId: z.string().uuid().nullable().optional(),
})

async function validateRefs(
  tenantId: string,
  body: { parentId?: string | null; defaultRoleId?: string | null },
  selfId?: string,
) {
  if (body.parentId) {
    if (selfId && body.parentId === selfId) {
      return 'Position cannot be its own parent'
    }
    const parent = await db.query.positions.findFirst({
      where: and(eq(positions.id, body.parentId), eq(positions.tenantId, tenantId)),
    })
    if (!parent) {
      return 'Parent position not found in this tenant'
    }
  }
  if (body.defaultRoleId) {
    const role = await db.query.roles.findFirst({
      where: and(eq(roles.id, body.defaultRoleId), eq(roles.tenantId, tenantId)),
    })
    if (!role) {
      return 'Default role not found in this tenant'
    }
  }
  return null
}

positionsRouter.get('/', async (c) => {
  const tenant = c.get('tenant')

  const rows = await db
    .select({
      id: positions.id,
      tenantId: positions.tenantId,
      name: positions.name,
      level: positions.level,
      parentId: positions.parentId,
      defaultRoleId: positions.defaultRoleId,
      defaultRoleName: roles.name,
      createdAt: positions.createdAt,
      updatedAt: positions.updatedAt,
    })
    .from(positions)
    .leftJoin(roles, eq(positions.defaultRoleId, roles.id))
    .where(eq(positions.tenantId, tenant.tenantId))
    .orderBy(desc(positions.level), asc(positions.name))

  return c.json({ positions: rows })
})

positionsRouter.post('/', async (c) => {
  const tenant = c.get('tenant')
  const user = c.get('user')
  if (!canManage(tenant.tenantRole, user.platformRole)) {
    return c.json({ error: 'Insufficient permissions' }, 403)
  }

  const body = positionSchema.parse(await c.req.json())

  const refError = await validateRefs(tenant.tenantId, body)
  if (refError) {
    return c.json({ error: refError }, 400)
  }

  const existing = await db.query.positions.findFirst({
    where: and(eq(positions.tenantId, tenant.tenantId), eq(positions.name, body.name)),
  })
  if (existing) {
    return c.json({ error: 'Position name already exists in this tenant' }, 409)
  }

  const [position] = await db.insert(positions).values({
    tenantId: tenant.tenantId,
    name: body.name,
    level: body.level ?? 0,
    parentId: body.parentId ?? null,
    defaultRoleId: body.defaultRoleId ?? null,
  }).returning()

  return c.json({ position }, 201)
})

positionsRouter.patch('/:id', async (c) => {
  const tenant = c.get('tenant')
  const user = c.get('user')
  if (!canManage(tenant.tenantRole, user.platformRole)) {
    return c.json({ error: 'Insufficient permissions' }, 403)
  }

  const { id } = c.req.param()
  const body = positionSchema.partial().parse(await c.req.json())

  const position = await db.query.positions.findFirst({
    where: and(eq(positions.id, id), eq(positions.tenantId, tenant.tenantId)),
  })
  if (!position) {
    return c.json({ error: 'Position not found' }, 404)
  }

  const refError = await validateRefs(tenant.tenantId, body, id)
  if (refError) {
    return c.json({ error: refError }, 400)
  }

  if (body.name && body.name !== position.name) {
    const existing = await db.query.positions.findFirst({
      where: and(eq(positions.tenantId, tenant.tenantId), eq(positions.name, body.name)),
    })
    if (existing) {
      return c.json({ error: 'Position name already exists in this tenant' }, 409)
    }
  }

  const [updated] = await db
    .update(positions)
    .set({ ...body, updatedAt: new Date() })
    .where(and(eq(positions.id, id), eq(positions.tenantId, tenant.tenantId)))
    .returning()

  return c.json({ position: updated })
})

positionsRouter.delete('/:id', async (c) => {
  const tenant = c.get('tenant')
  const user = c.get('user')
  if (!canManage(tenant.tenantRole, user.platformRole)) {
    return c.json({ error: 'Insufficient permissions' }, 403)
  }

  const { id } = c.req.param()

  const position = await db.query.positions.findFirst({
    where: and(eq(positions.id, id), eq(positions.tenantId, tenant.tenantId)),
  })
  if (!position) {
    return c.json({ error: 'Position not found' }, 404)
  }

  const inUse = await db.query.tenantMembers.findFirst({
    where: eq(tenantMembers.positionId, id),
  })
  if (inUse) {
    return c.json({ error: 'Position is still assigned to members' }, 400)
  }

  const hasChildren = await db.query.positions.findFirst({
    where: eq(positions.parentId, id),
  })
  if (hasChildren) {
    return c.json({ error: 'Position still has sub-positions' }, 400)
  }

  await db.delete(positions).where(and(eq(positions.id, id), eq(positions.tenantId, tenant.tenantId)))

  return c.json({ success: true })
})

export default positionsRouter
