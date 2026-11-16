import { Hono } from 'hono'
import { z } from 'zod'
import { eq, and, isNull, SQL, ilike, count } from 'drizzle-orm'
import { db } from '../../../db'
import { projects, projectMembers, projectMilestones, kanbanColumns, tenants, users } from '../../../db/schema'
import { authMiddleware, type Variables as AuthVariables } from '../../../middleware/auth'
import { requireModuleAccess } from '../../../middleware/rbac'
import { tenantMiddleware, type TenantVariables } from '../../../middleware/tenant'
import { parsePagination, paginated } from '../../../lib/pagination'
import { validate, getValidated } from '../../../middleware/validate'
import { recordAudit } from '../../../lib/audit'

type Variables = AuthVariables & TenantVariables

const projectsRouter = new Hono<{ Variables: Variables }>()
projectsRouter.use('*', authMiddleware)
projectsRouter.use('*', tenantMiddleware)
projectsRouter.use('*', requireModuleAccess('projects:read', 'projects:write'))

const createProjectSchema = z.object({
  projectCode: z.string().min(1).max(100),
  name: z.string().min(1).max(255),
  clientId: z.string().uuid().optional(),
  projectManagerId: z.string().uuid(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  status: z.enum(['planning', 'active', 'on_hold', 'completed', 'cancelled']).default('planning'),
  budget: z.number().min(0).default(0),
  description: z.string().optional(),
})

const updateProjectSchema = createProjectSchema.partial()

const addMemberSchema = z.object({
  userId: z.string().uuid(),
  roleInProject: z.enum(['lead', 'developer', 'designer', 'qa', 'viewer']).default('viewer'),
})

const createMilestoneSchema = z.object({
  title: z.string().min(1).max(255),
  description: z.string().optional(),
  dueDate: z.string().optional(),
})

const createColumnSchema = z.object({
  name: z.string().min(1).max(100),
  position: z.number().min(0),
  colorCode: z.string().max(20).default('#6B7280'),
})

/**
 * Platform scope (hub-admin) — header `X-Platform-Scope: all` ATAU query
 * `?scope=all`. Mengikuti pola clients.ts: saat aktif, query TIDAK difilter
 * tenant_id sehingga frontend platform view bisa melihat gabungan semua
 * tenant. Tenant filter tetap wajib untuk semua role lain (isolasi).
 */
function isPlatformScope(c: any): boolean {
  const user = c.get('user')
  if (user?.platformRole !== 'hub-admin') return false
  const headerScope = c.req.header('X-Platform-Scope')
  if (headerScope === 'all') return true
  const queryScope = c.req.query('scope')
  return queryScope === 'all'
}

// List projects
projectsRouter.get('/', async (c) => {
  const tenant = c.get('tenant')
  const { search, status } = c.req.query()

  const { page, limit, offset } = parsePagination(c)
  const platformScope = isPlatformScope(c)

  // Soft delete: project terhapus tidak boleh tampil di list.
  const conditions: SQL[] = [isNull(projects.deletedAt)]

  // Tenant filter hanya saat bukan platform scope (isolasi per-company).
  if (!platformScope) {
    conditions.push(eq(projects.tenantId, tenant.tenantId))
  }

  if (search) conditions.push(ilike(projects.name, `%${search}%`))
  if (status) conditions.push(eq(projects.status, status))

  const where = and(...conditions)

  const [data, totalRows] = await Promise.all([
    db.query.projects.findMany({
      where,
      orderBy: (fields, { desc }) => [desc(fields.createdAt)],
      limit,
      offset,
    }),
    db.select({ total: count() }).from(projects).where(where),
  ])

  // Platform scope: sertakan tenantName untuk tagging di frontend.
  if (platformScope && data.length > 0) {
    const tenantRows = await db.select({ id: tenants.id, name: tenants.name }).from(tenants)
    const nameById = new Map(tenantRows.map((t) => [t.id, t.name]))
    const enriched = data.map((p) => ({ ...p, tenantName: nameById.get(p.tenantId) ?? null }))
    return c.json(paginated('projects', enriched, totalRows[0]?.total ?? 0, { page, limit, offset }))
  }

  return c.json(paginated('projects', data, totalRows[0]?.total ?? 0, { page, limit, offset }))
})

// Project stats
projectsRouter.get('/stats', async (c) => {
  const tenant = c.get('tenant')
  const platformScope = isPlatformScope(c)

  const all = await db.query.projects.findMany({
    where: platformScope
      ? isNull(projects.deletedAt)
      : and(eq(projects.tenantId, tenant.tenantId), isNull(projects.deletedAt)),
    columns: { status: true, budget: true },
  })

  const stats = {
    total: all.length,
    planning: all.filter((p) => p.status === 'planning').length,
    active: all.filter((p) => p.status === 'active').length,
    onHold: all.filter((p) => p.status === 'on_hold').length,
    completed: all.filter((p) => p.status === 'completed').length,
    cancelled: all.filter((p) => p.status === 'cancelled').length,
    totalBudget: all.reduce((sum, p) => sum + Number(p.budget), 0),
  }

  return c.json({ stats })
})

// Get project detail with members, milestones, columns
projectsRouter.get('/:id', async (c) => {
  const tenant = c.get('tenant')
  const { id } = c.req.param()
  const platformScope = isPlatformScope(c)

  const project = await db.query.projects.findFirst({
    where: platformScope
      ? and(eq(projects.id, id), isNull(projects.deletedAt))
      : and(eq(projects.id, id), eq(projects.tenantId, tenant.tenantId), isNull(projects.deletedAt)),
  })

  if (!project) return c.json({ error: 'Project not found' }, 404)

  const members = await db.query.projectMembers.findMany({
    where: eq(projectMembers.projectId, id),
  })

  const milestones = await db.query.projectMilestones.findMany({
    where: eq(projectMilestones.projectId, id),
    orderBy: (fields, { asc }) => [asc(fields.dueDate)],
  })

  const columns = await db.query.kanbanColumns.findMany({
    where: eq(kanbanColumns.projectId, id),
    orderBy: (fields, { asc }) => [asc(fields.position)],
  })

  return c.json({ project: { ...project, members, milestones, columns } })
})

// Create project
projectsRouter.post('/', validate(createProjectSchema, 'json'), async (c) => {
  const tenant = c.get('tenant')
  const authUser = c.get('user')
  const body = getValidated<typeof createProjectSchema>(c, 'json')!

  // Platform view tidak punya tenant context — create wajib dalam tenant.
  if (tenant.tenantId === '*') {
    return c.json({ error: 'Pilih company terlebih dahulu untuk membuat project' }, 400)
  }

  // project_code unik GLOBAL di level DB — tangkap duplikat dengan 409 rapi
  // alih-alih membiarkan unique violation jadi 500.
  const codeTaken = await db.query.projects.findFirst({
    where: eq(projects.projectCode, body.projectCode),
    columns: { id: true },
  })
  if (codeTaken) {
    return c.json({ error: 'Project code already taken' }, 409)
  }

  const [project] = await db.insert(projects).values({
    ...body,
    tenantId: tenant.tenantId,
    createdBy: authUser.id,
    budget: String(body.budget),
  }).returning()

  // Add PM as member
  await db.insert(projectMembers).values({
    projectId: project.id,
    userId: body.projectManagerId,
    roleInProject: 'lead',
  })

  // Create default kanban columns
  const defaultColumns = ['Backlog', 'To Do', 'In Progress', 'Code Review', 'Done']
  await db.insert(kanbanColumns).values(
    defaultColumns.map((name, index) => ({
      projectId: project.id,
      name,
      position: index,
    }))
  )

  await recordAudit(c, tenant.tenantId, {
    action: 'project.create',
    module: 'projects',
    recordId: project.id,
    newValues: { name: project.name, projectCode: project.projectCode, status: project.status },
  })

  return c.json({ project }, 201)
})

// Update project
projectsRouter.patch('/:id', validate(updateProjectSchema, 'json'), async (c) => {
  const tenant = c.get('tenant')
  const { id } = c.req.param()
  const body = getValidated<typeof updateProjectSchema>(c, 'json')!
  const platformScope = isPlatformScope(c)

  const existing = await db.query.projects.findFirst({
    where: platformScope
      ? and(eq(projects.id, id), isNull(projects.deletedAt))
      : and(eq(projects.id, id), eq(projects.tenantId, tenant.tenantId), isNull(projects.deletedAt)),
  })
  if (!existing) return c.json({ error: 'Project not found' }, 404)

  const [updated] = await db
    .update(projects)
    .set({
      ...body,
      budget: body.budget ? String(body.budget) : undefined,
      updatedAt: new Date(),
    })
    .where(platformScope
      ? eq(projects.id, id)
      : and(eq(projects.id, id), eq(projects.tenantId, tenant.tenantId)))
    .returning()

  // Audit butuh tenant nyata (FK) — lewati pada platform scope.
  if (!platformScope) await recordAudit(c, tenant.tenantId, {
    action: 'project.update',
    module: 'projects',
    recordId: id,
    oldValues: { name: existing.name, status: existing.status, budget: existing.budget },
    newValues: { name: updated.name, status: updated.status, budget: updated.budget },
  })

  return c.json({ project: updated })
})

// Add member
projectsRouter.post('/:id/members', validate(addMemberSchema, 'json'), async (c) => {
  const tenant = c.get('tenant')
  const { id } = c.req.param()
  const body = getValidated<typeof addMemberSchema>(c, 'json')!

  // Verify project belongs to tenant (platform scope hub-admin: bebas tenant)
  const project = await db.query.projects.findFirst({
    where: isPlatformScope(c)
      ? and(eq(projects.id, id), isNull(projects.deletedAt))
      : and(eq(projects.id, id), eq(projects.tenantId, tenant.tenantId)),
  })
  if (!project) return c.json({ error: 'Project not found' }, 404)

  // User wajib ada — tanpa ini insert project_members dengan uuid sembarang
  // menabrak FK (500) alih-alih 404 rapi.
  const user = await db.query.users.findFirst({
    where: eq(users.id, body.userId),
    columns: { id: true },
  })
  if (!user) return c.json({ error: 'User not found' }, 404)

  const [member] = await db.insert(projectMembers).values({
    projectId: id,
    ...body,
  }).returning()

  return c.json({ member }, 201)
})

// Remove member
projectsRouter.delete('/:id/members/:userId', async (c) => {
  const tenant = c.get('tenant')
  const { id, userId } = c.req.param()

  const project = await db.query.projects.findFirst({
    where: isPlatformScope(c)
      ? and(eq(projects.id, id), isNull(projects.deletedAt))
      : and(eq(projects.id, id), eq(projects.tenantId, tenant.tenantId)),
  })
  if (!project) return c.json({ error: 'Project not found' }, 404)

  await db.delete(projectMembers).where(
    and(eq(projectMembers.projectId, id), eq(projectMembers.userId, userId))
  )

  return c.json({ message: 'Member removed' })
})

// Create milestone
projectsRouter.post('/:id/milestones', validate(createMilestoneSchema, 'json'), async (c) => {
  const tenant = c.get('tenant')
  const { id } = c.req.param()
  const body = getValidated<typeof createMilestoneSchema>(c, 'json')!

  const project = await db.query.projects.findFirst({
    where: isPlatformScope(c)
      ? and(eq(projects.id, id), isNull(projects.deletedAt))
      : and(eq(projects.id, id), eq(projects.tenantId, tenant.tenantId)),
  })
  if (!project) return c.json({ error: 'Project not found' }, 404)

  const [milestone] = await db.insert(projectMilestones).values({
    projectId: id,
    ...body,
    dueDate: body.dueDate || null,
  }).returning()

  return c.json({ milestone }, 201)
})

// Create kanban column
projectsRouter.post('/:id/columns', validate(createColumnSchema, 'json'), async (c) => {
  const tenant = c.get('tenant')
  const { id } = c.req.param()
  const body = getValidated<typeof createColumnSchema>(c, 'json')!

  const project = await db.query.projects.findFirst({
    where: isPlatformScope(c)
      ? and(eq(projects.id, id), isNull(projects.deletedAt))
      : and(eq(projects.id, id), eq(projects.tenantId, tenant.tenantId)),
  })
  if (!project) return c.json({ error: 'Project not found' }, 404)

  const [column] = await db.insert(kanbanColumns).values({
    projectId: id,
    ...body,
  }).returning()

  return c.json({ column }, 201)
})

// Delete project (soft delete)
projectsRouter.delete('/:id', async (c) => {
  const tenant = c.get('tenant')
  const { id } = c.req.param()
  const platformScope = isPlatformScope(c)

  // isNull(deletedAt): arsip dobel → 404, bukan memperbarui baris arsip lagi.
  const [deleted] = await db
    .update(projects)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(platformScope
      ? and(eq(projects.id, id), isNull(projects.deletedAt))
      : and(eq(projects.id, id), eq(projects.tenantId, tenant.tenantId), isNull(projects.deletedAt)))
    .returning()

  if (!deleted) return c.json({ error: 'Project not found' }, 404)

  // Audit butuh tenant nyata (FK) — lewati pada platform scope.
  if (!platformScope) await recordAudit(c, tenant.tenantId, {
    action: 'project.delete',
    module: 'projects',
    recordId: id,
    oldValues: { name: deleted.name, projectCode: deleted.projectCode },
    newValues: { softDelete: true },
  })

  return c.json({ message: 'Project deleted' })
})

export default projectsRouter
