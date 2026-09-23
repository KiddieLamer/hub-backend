import { Hono } from 'hono'
import { z } from 'zod'
import { eq, and, SQL, ilike } from 'drizzle-orm'
import { db } from '../../../db'
import { projects, projectMembers, projectMilestones, kanbanColumns } from '../../../db/schema'
import { authMiddleware, type Variables as AuthVariables } from '../../../middleware/auth'
import { requireModuleAccess } from '../../../middleware/rbac'
import { tenantMiddleware, type TenantVariables } from '../../../middleware/tenant'

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

// List projects
projectsRouter.get('/', async (c) => {
  const tenant = c.get('tenant')
  const { search, status } = c.req.query()

  const conditions: SQL[] = [eq(projects.tenantId, tenant.tenantId)]

  if (search) conditions.push(ilike(projects.name, `%${search}%`))
  if (status) conditions.push(eq(projects.status, status))

  const data = await db.query.projects.findMany({
    where: and(...conditions),
    orderBy: (fields, { desc }) => [desc(fields.createdAt)],
  })

  return c.json({ projects: data, total: data.length })
})

// Project stats
projectsRouter.get('/stats', async (c) => {
  const tenant = c.get('tenant')

  const all = await db.query.projects.findMany({
    where: eq(projects.tenantId, tenant.tenantId),
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

  const project = await db.query.projects.findFirst({
    where: and(eq(projects.id, id), eq(projects.tenantId, tenant.tenantId)),
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
projectsRouter.post('/', async (c) => {
  const tenant = c.get('tenant')
  const authUser = c.get('user')
  const body = createProjectSchema.parse(await c.req.json())

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

  return c.json({ project }, 201)
})

// Update project
projectsRouter.patch('/:id', async (c) => {
  const tenant = c.get('tenant')
  const { id } = c.req.param()
  const body = createProjectSchema.partial().parse(await c.req.json())

  const [updated] = await db
    .update(projects)
    .set({
      ...body,
      budget: body.budget ? String(body.budget) : undefined,
      updatedAt: new Date(),
    })
    .where(and(eq(projects.id, id), eq(projects.tenantId, tenant.tenantId)))
    .returning()

  if (!updated) return c.json({ error: 'Project not found' }, 404)

  return c.json({ project: updated })
})

// Add member
projectsRouter.post('/:id/members', async (c) => {
  const tenant = c.get('tenant')
  const { id } = c.req.param()
  const body = addMemberSchema.parse(await c.req.json())

  // Verify project belongs to tenant
  const project = await db.query.projects.findFirst({
    where: and(eq(projects.id, id), eq(projects.tenantId, tenant.tenantId)),
  })
  if (!project) return c.json({ error: 'Project not found' }, 404)

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
    where: and(eq(projects.id, id), eq(projects.tenantId, tenant.tenantId)),
  })
  if (!project) return c.json({ error: 'Project not found' }, 404)

  await db.delete(projectMembers).where(
    and(eq(projectMembers.projectId, id), eq(projectMembers.userId, userId))
  )

  return c.json({ message: 'Member removed' })
})

// Create milestone
projectsRouter.post('/:id/milestones', async (c) => {
  const tenant = c.get('tenant')
  const { id } = c.req.param()
  const body = createMilestoneSchema.parse(await c.req.json())

  const project = await db.query.projects.findFirst({
    where: and(eq(projects.id, id), eq(projects.tenantId, tenant.tenantId)),
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
projectsRouter.post('/:id/columns', async (c) => {
  const tenant = c.get('tenant')
  const { id } = c.req.param()
  const body = createColumnSchema.parse(await c.req.json())

  const project = await db.query.projects.findFirst({
    where: and(eq(projects.id, id), eq(projects.tenantId, tenant.tenantId)),
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

  const [deleted] = await db
    .update(projects)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(projects.id, id), eq(projects.tenantId, tenant.tenantId)))
    .returning()

  if (!deleted) return c.json({ error: 'Project not found' }, 404)

  return c.json({ message: 'Project deleted' })
})

export default projectsRouter
