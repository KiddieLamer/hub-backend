import { Hono } from 'hono'
import { z } from 'zod'
import { eq, and, inArray, SQL } from 'drizzle-orm'
import { db } from '../../../db'
import { tasks, taskAssignees, taskComments, taskTagMappings, projects } from '../../../db/schema'
import { authMiddleware, type Variables as AuthVariables } from '../../../middleware/auth'
import { requireModuleAccess } from '../../../middleware/rbac'
import { tenantMiddleware, type TenantVariables } from '../../../middleware/tenant'

type Variables = AuthVariables & TenantVariables

const tasksRouter = new Hono<{ Variables: Variables }>()
tasksRouter.use('*', authMiddleware)
tasksRouter.use('*', tenantMiddleware)
tasksRouter.use('*', requireModuleAccess('projects:read', 'projects:write'))

const createTaskSchema = z.object({
  projectId: z.string().uuid(),
  columnId: z.string().uuid(),
  milestoneId: z.string().uuid().optional(),
  parentTaskId: z.string().uuid().optional(),
  title: z.string().min(1).max(255),
  description: z.string().optional(),
  assignedTo: z.string().uuid().optional(),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).default('medium'),
  dueDate: z.string().optional(),
  estimatedHours: z.number().min(0).optional(),
  position: z.number().default(0),
})

const moveTaskSchema = z.object({
  columnId: z.string().uuid(),
  position: z.number(),
})

const commentSchema = z.object({
  comment: z.string().min(1),
  fileUrl: z.string().url().optional(),
})

const assigneeSchema = z.object({
  userId: z.string().uuid(),
})

const taskTagSchema = z.object({
  tagId: z.string().uuid(),
})

tasksRouter.get('/', async (c) => {
  const tenant = c.get('tenant')
  const { projectId, columnId, assignedTo, priority } = c.req.query()

  const tenantProjectIds = db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.tenantId, tenant.tenantId))

  const conditions: SQL[] = [inArray(tasks.projectId, tenantProjectIds)]

  if (projectId) conditions.push(eq(tasks.projectId, projectId))
  if (columnId) conditions.push(eq(tasks.columnId, columnId))
  if (assignedTo) conditions.push(eq(tasks.assignedTo, assignedTo))
  if (priority) conditions.push(eq(tasks.priority, priority))

  const data = await db.query.tasks.findMany({
    where: and(...conditions),
    orderBy: (fields, { asc }) => [asc(fields.position)],
  })

  return c.json({ tasks: data, total: data.length })
})

tasksRouter.get('/:id', async (c) => {
  const tenant = c.get('tenant')
  const { id } = c.req.param()

  const tenantProjectIds = db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.tenantId, tenant.tenantId))

  const task = await db.query.tasks.findFirst({
    where: and(eq(tasks.id, id), inArray(tasks.projectId, tenantProjectIds)),
  })

  if (!task) return c.json({ error: 'Task not found' }, 404)

  const assignees = await db.query.taskAssignees.findMany({
    where: eq(taskAssignees.taskId, id),
  })

  const comments = await db.query.taskComments.findMany({
    where: eq(taskComments.taskId, id),
    orderBy: (fields, { desc }) => [desc(fields.createdAt)],
  })

  const tagMappings = await db.query.taskTagMappings.findMany({
    where: eq(taskTagMappings.taskId, id),
  })

  return c.json({ task: { ...task, assignees, comments, tagIds: tagMappings.map((m) => m.tagId) } })
})

tasksRouter.post('/', async (c) => {
  const tenant = c.get('tenant')
  const authUser = c.get('user')
  const body = createTaskSchema.parse(await c.req.json())

  const tenantProjectIds = db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.tenantId, tenant.tenantId))

  const projectAllowed = await db.query.projects.findFirst({
    where: and(eq(projects.id, body.projectId), inArray(projects.id, tenantProjectIds)),
  })

  if (!projectAllowed) return c.json({ error: 'Project not found' }, 404)

  const [task] = await db.insert(tasks).values({
    ...body,
    createdBy: authUser.id,
    dueDate: body.dueDate ? new Date(body.dueDate) : null,
    estimatedHours: body.estimatedHours ? String(body.estimatedHours) : null,
  }).returning()

  if (body.assignedTo) {
    await db.insert(taskAssignees).values({
      taskId: task.id,
      userId: body.assignedTo,
    })
  }

  return c.json({ task }, 201)
})

tasksRouter.patch('/:id', async (c) => {
  const tenant = c.get('tenant')
  const { id } = c.req.param()
  const body = createTaskSchema.partial().parse(await c.req.json())

  const tenantProjectIds = db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.tenantId, tenant.tenantId))

  const [updated] = await db
    .update(tasks)
    .set({
      ...body,
      dueDate: body.dueDate ? new Date(body.dueDate) : undefined,
      estimatedHours: body.estimatedHours ? String(body.estimatedHours) : undefined,
      updatedAt: new Date(),
    })
    .where(and(eq(tasks.id, id), inArray(tasks.projectId, tenantProjectIds)))
    .returning()

  if (!updated) return c.json({ error: 'Task not found' }, 404)

  return c.json({ task: updated })
})

tasksRouter.post('/:id/move', async (c) => {
  const tenant = c.get('tenant')
  const { id } = c.req.param()
  const body = moveTaskSchema.parse(await c.req.json())

  const tenantProjectIds = db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.tenantId, tenant.tenantId))

  const [updated] = await db
    .update(tasks)
    .set({
      columnId: body.columnId,
      position: body.position,
      updatedAt: new Date(),
    })
    .where(and(eq(tasks.id, id), inArray(tasks.projectId, tenantProjectIds)))
    .returning()

  if (!updated) return c.json({ error: 'Task not found' }, 404)

  return c.json({ task: updated })
})

tasksRouter.post('/:id/assignees', async (c) => {
  const tenant = c.get('tenant')
  const { id } = c.req.param()
  const { userId } = assigneeSchema.parse(await c.req.json())

  const tenantProjectIds = db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.tenantId, tenant.tenantId))

  const task = await db.query.tasks.findFirst({
    where: and(eq(tasks.id, id), inArray(tasks.projectId, tenantProjectIds)),
  })

  if (!task) return c.json({ error: 'Task not found' }, 404)

  const [assignee] = await db.insert(taskAssignees).values({
    taskId: id,
    userId,
  }).returning()

  return c.json({ assignee }, 201)
})

tasksRouter.delete('/:id/assignees/:userId', async (c) => {
  const tenant = c.get('tenant')
  const { id, userId } = c.req.param()

  const tenantProjectIds = db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.tenantId, tenant.tenantId))

  const task = await db.query.tasks.findFirst({
    where: and(eq(tasks.id, id), inArray(tasks.projectId, tenantProjectIds)),
  })

  if (!task) return c.json({ error: 'Task not found' }, 404)

  await db.delete(taskAssignees).where(
    and(eq(taskAssignees.taskId, id), eq(taskAssignees.userId, userId))
  )

  return c.json({ message: 'Assignee removed' })
})

tasksRouter.post('/:id/comments', async (c) => {
  const tenant = c.get('tenant')
  const authUser = c.get('user')
  const { id } = c.req.param()
  const body = commentSchema.parse(await c.req.json())

  const tenantProjectIds = db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.tenantId, tenant.tenantId))

  const task = await db.query.tasks.findFirst({
    where: and(eq(tasks.id, id), inArray(tasks.projectId, tenantProjectIds)),
  })

  if (!task) return c.json({ error: 'Task not found' }, 404)

  const [comment] = await db.insert(taskComments).values({
    taskId: id,
    userId: authUser.id,
    ...body,
  }).returning()

  return c.json({ comment }, 201)
})

tasksRouter.delete('/:id/comments/:commentId', async (c) => {
  const tenant = c.get('tenant')
  const { id, commentId } = c.req.param()

  const tenantProjectIds = db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.tenantId, tenant.tenantId))

  const task = await db.query.tasks.findFirst({
    where: and(eq(tasks.id, id), inArray(tasks.projectId, tenantProjectIds)),
  })

  if (!task) return c.json({ error: 'Task not found' }, 404)

  await db.delete(taskComments).where(eq(taskComments.id, commentId))

  return c.json({ message: 'Comment deleted' })
})

tasksRouter.post('/:id/tags', async (c) => {
  const tenant = c.get('tenant')
  const { id } = c.req.param()
  const { tagId } = taskTagSchema.parse(await c.req.json())

  const tenantProjectIds = db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.tenantId, tenant.tenantId))

  const task = await db.query.tasks.findFirst({
    where: and(eq(tasks.id, id), inArray(tasks.projectId, tenantProjectIds)),
  })

  if (!task) return c.json({ error: 'Task not found' }, 404)

  await db.insert(taskTagMappings).values({
    taskId: id,
    tagId,
  })

  return c.json({ message: 'Tag added' }, 201)
})

tasksRouter.delete('/:id/tags/:tagId', async (c) => {
  const tenant = c.get('tenant')
  const { id, tagId } = c.req.param()

  const tenantProjectIds = db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.tenantId, tenant.tenantId))

  const task = await db.query.tasks.findFirst({
    where: and(eq(tasks.id, id), inArray(tasks.projectId, tenantProjectIds)),
  })

  if (!task) return c.json({ error: 'Task not found' }, 404)

  await db.delete(taskTagMappings).where(
    and(eq(taskTagMappings.taskId, id), eq(taskTagMappings.tagId, tagId))
  )

  return c.json({ message: 'Tag removed' })
})

tasksRouter.delete('/:id', async (c) => {
  const tenant = c.get('tenant')
  const { id } = c.req.param()

  const tenantProjectIds = db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.tenantId, tenant.tenantId))

  const [deleted] = await db
    .update(tasks)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(tasks.id, id), inArray(tasks.projectId, tenantProjectIds)))
    .returning()

  if (!deleted) return c.json({ error: 'Task not found' }, 404)

  return c.json({ message: 'Task deleted' })
})

export default tasksRouter
