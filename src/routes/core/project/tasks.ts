import { Hono } from 'hono'
import { z } from 'zod'
import { eq, and, inArray, isNull, SQL, count } from 'drizzle-orm'
import { db } from '../../../db'
import { tasks, taskAssignees, taskComments, taskTagMappings, projects, kanbanColumns, projectMilestones } from '../../../db/schema'
import { authMiddleware, type Variables as AuthVariables } from '../../../middleware/auth'
import { requireModuleAccess } from '../../../middleware/rbac'
import { tenantMiddleware, type TenantVariables } from '../../../middleware/tenant'
import { parsePagination, paginated } from '../../../lib/pagination'
import { validate, getValidated } from '../../../middleware/validate'
import { recordAudit } from '../../../lib/audit'

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

const updateTaskSchema = createTaskSchema.partial()

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

// Platform scope — sama dengan projects.ts/clients.ts.
function isPlatformScope(c: any): boolean {
  const user = c.get('user')
  if (user?.platformRole !== 'hub-admin') return false
  const headerScope = c.req.header('X-Platform-Scope')
  if (headerScope === 'all') return true
  const queryScope = c.req.query('scope')
  return queryScope === 'all'
}

tasksRouter.get('/', async (c) => {
  const tenant = c.get('tenant')
  const { projectId, columnId, assignedTo, priority } = c.req.query()
  const pagination = parsePagination(c)

  // Isolasi via project + soft delete: task dari project yang sudah
  // dihapus tidak ikut tampil/mutasi. Platform scope (hub-admin): semua
  // project aktif tenant manapun.
  const tenantProjectIds = db
    .select({ id: projects.id })
    .from(projects)
    .where(isPlatformScope(c)
      ? isNull(projects.deletedAt)
      : and(eq(projects.tenantId, tenant.tenantId), isNull(projects.deletedAt)))

  // Platform scope (hub-admin): gabungan task semua tenant — TETAP dibatasi
  // ke project aktif (tenantProjectIds sudah memfilter deletedAt untuk kedua
  // scope). Dulu branch platform memakai [isNull(tasks.deletedAt)] saja →
  // task "hantu" dari project yang sudah diarsipkan/dihapus ikut terhitung
  // di metrics (Still Running 6 padahal task valid 2).
  const conditions: SQL[] = [inArray(tasks.projectId, tenantProjectIds)]

  if (projectId) conditions.push(eq(tasks.projectId, projectId))
  if (columnId) conditions.push(eq(tasks.columnId, columnId))
  if (assignedTo) conditions.push(eq(tasks.assignedTo, assignedTo))
  if (priority) conditions.push(eq(tasks.priority, priority))

  const where = and(...conditions)

  const [data, [{ value: total }]] = await Promise.all([
    db.query.tasks.findMany({
      where,
      orderBy: (fields, { asc }) => [asc(fields.position)],
      limit: pagination.limit,
      offset: pagination.offset,
    }),
    db.select({ value: count() }).from(tasks).where(where),
  ])

  return c.json(paginated('tasks', data, Number(total), pagination))
})

tasksRouter.get('/:id', async (c) => {
  const tenant = c.get('tenant')
  const { id } = c.req.param()

  // Isolasi via project + soft delete: task dari project yang sudah
  // dihapus tidak ikut tampil/mutasi. Platform scope (hub-admin): semua
  // project aktif tenant manapun.
  const tenantProjectIds = db
    .select({ id: projects.id })
    .from(projects)
    .where(isPlatformScope(c)
      ? isNull(projects.deletedAt)
      : and(eq(projects.tenantId, tenant.tenantId), isNull(projects.deletedAt)))

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

tasksRouter.post('/', validate(createTaskSchema, 'json'), async (c) => {
  const tenant = c.get('tenant')
  const authUser = c.get('user')
  const body = getValidated<typeof createTaskSchema>(c, 'json')!

  // Isolasi via project + soft delete: task dari project yang sudah
  // dihapus tidak ikut tampil/mutasi. Platform scope (hub-admin): semua
  // project aktif tenant manapun.
  const tenantProjectIds = db
    .select({ id: projects.id })
    .from(projects)
    .where(isPlatformScope(c)
      ? isNull(projects.deletedAt)
      : and(eq(projects.tenantId, tenant.tenantId), isNull(projects.deletedAt)))

  const projectAllowed = await db.query.projects.findFirst({
    where: and(eq(projects.id, body.projectId), inArray(projects.id, tenantProjectIds)),
  })

  if (!projectAllowed) return c.json({ error: 'Project not found' }, 404)

  // ColumnId wajib milik project yang sama (FK hanya cek keberadaan, bukan
  // kepemilikan tenant — tanpa guard ini task bisa menunjuk kolom tenant lain).
  const columnAllowed = await db.query.kanbanColumns.findFirst({
    where: and(
      eq(kanbanColumns.id, body.columnId),
      eq(kanbanColumns.projectId, body.projectId),
    ),
  })
  if (!columnAllowed) return c.json({ error: 'Column not found' }, 404)

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

  // Audit butuh tenant nyata (FK) — lewati pada platform scope.
  if (tenant.tenantId !== '*') await recordAudit(c, tenant.tenantId, {
    action: 'task.create',
    module: 'projects',
    recordId: task.id,
    newValues: { title: task.title, projectId: task.projectId, priority: task.priority },
  })

  return c.json({ task }, 201)
})

tasksRouter.patch('/:id', validate(updateTaskSchema, 'json'), async (c) => {
  const tenant = c.get('tenant')
  const { id } = c.req.param()
  const body = getValidated<typeof updateTaskSchema>(c, 'json')!

  // Isolasi via project + soft delete: task dari project yang sudah
  // dihapus tidak ikut tampil/mutasi. Platform scope (hub-admin): semua
  // project aktif tenant manapun.
  const tenantProjectIds = db
    .select({ id: projects.id })
    .from(projects)
    .where(isPlatformScope(c)
      ? isNull(projects.deletedAt)
      : and(eq(projects.tenantId, tenant.tenantId), isNull(projects.deletedAt)))

  const current = await db.query.tasks.findFirst({
    where: and(eq(tasks.id, id), inArray(tasks.projectId, tenantProjectIds)),
  })
  if (!current) return c.json({ error: 'Task not found' }, 404)

  // ANTI RE-PARENT LINTAS TENANT: projectId baru wajib milik tenant yang
  // sama. Tanpa guard ini task bisa "dipindahkan" ke project tenant lain
  // hanya dengan mengirim uuid project tersebut (FK lolos karena project
  // memang ada) — lubang isolasi.
  if (body.projectId && body.projectId !== current.projectId) {
    const targetAllowed = await db.query.projects.findFirst({
      where: and(eq(projects.id, body.projectId), inArray(projects.id, tenantProjectIds)),
    })
    if (!targetAllowed) return c.json({ error: 'Project not found' }, 404)
    // Kolom target wajib milik project tujuan.
    if (body.columnId) {
      const colAllowed = await db.query.kanbanColumns.findFirst({
        where: and(eq(kanbanColumns.id, body.columnId), eq(kanbanColumns.projectId, body.projectId)),
      })
      if (!colAllowed) return c.json({ error: 'Column not found' }, 404)
    }
  }

  if (body.columnId && !body.projectId) {
    const colAllowed = await db.query.kanbanColumns.findFirst({
      where: and(
        eq(kanbanColumns.id, body.columnId),
        eq(kanbanColumns.projectId, current.projectId),
      ),
    })
    if (!colAllowed) return c.json({ error: 'Column not found' }, 404)
  }

  if (body.milestoneId) {
    const milestoneAllowed = await db.query.projectMilestones.findFirst({
      where: and(
        eq(projectMilestones.id, body.milestoneId),
        eq(projectMilestones.projectId, body.projectId ?? current.projectId),
      ),
    })
    if (!milestoneAllowed) return c.json({ error: 'Milestone not found' }, 404)
  }

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

tasksRouter.post('/:id/move', validate(moveTaskSchema, 'json'), async (c) => {
  const tenant = c.get('tenant')
  const { id } = c.req.param()
  const body = getValidated<typeof moveTaskSchema>(c, 'json')!

  // Isolasi via project + soft delete: task dari project yang sudah
  // dihapus tidak ikut tampil/mutasi. Platform scope (hub-admin): semua
  // project aktif tenant manapun.
  const tenantProjectIds = db
    .select({ id: projects.id })
    .from(projects)
    .where(isPlatformScope(c)
      ? isNull(projects.deletedAt)
      : and(eq(projects.tenantId, tenant.tenantId), isNull(projects.deletedAt)))

  const current = await db.query.tasks.findFirst({
    where: and(eq(tasks.id, id), inArray(tasks.projectId, tenantProjectIds)),
  })
  if (!current) return c.json({ error: 'Task not found' }, 404)

  // Kolom tujuan wajib milik project yang sama dengan task.
  const colAllowed = await db.query.kanbanColumns.findFirst({
    where: and(
      eq(kanbanColumns.id, body.columnId),
      eq(kanbanColumns.projectId, current.projectId),
    ),
  })
  if (!colAllowed) return c.json({ error: 'Column not found' }, 404)

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

tasksRouter.post('/:id/assignees', validate(assigneeSchema, 'json'), async (c) => {
  const tenant = c.get('tenant')
  const { id } = c.req.param()
  const { userId } = getValidated<typeof assigneeSchema>(c, 'json')!

  // Isolasi via project + soft delete: task dari project yang sudah
  // dihapus tidak ikut tampil/mutasi. Platform scope (hub-admin): semua
  // project aktif tenant manapun.
  const tenantProjectIds = db
    .select({ id: projects.id })
    .from(projects)
    .where(isPlatformScope(c)
      ? isNull(projects.deletedAt)
      : and(eq(projects.tenantId, tenant.tenantId), isNull(projects.deletedAt)))

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

  // Isolasi via project + soft delete: task dari project yang sudah
  // dihapus tidak ikut tampil/mutasi. Platform scope (hub-admin): semua
  // project aktif tenant manapun.
  const tenantProjectIds = db
    .select({ id: projects.id })
    .from(projects)
    .where(isPlatformScope(c)
      ? isNull(projects.deletedAt)
      : and(eq(projects.tenantId, tenant.tenantId), isNull(projects.deletedAt)))

  const task = await db.query.tasks.findFirst({
    where: and(eq(tasks.id, id), inArray(tasks.projectId, tenantProjectIds)),
  })

  if (!task) return c.json({ error: 'Task not found' }, 404)

  await db.delete(taskAssignees).where(
    and(eq(taskAssignees.taskId, id), eq(taskAssignees.userId, userId))
  )

  return c.json({ message: 'Assignee removed' })
})

tasksRouter.post('/:id/comments', validate(commentSchema, 'json'), async (c) => {
  const tenant = c.get('tenant')
  const authUser = c.get('user')
  const { id } = c.req.param()
  const body = getValidated<typeof commentSchema>(c, 'json')!

  // Isolasi via project + soft delete: task dari project yang sudah
  // dihapus tidak ikut tampil/mutasi. Platform scope (hub-admin): semua
  // project aktif tenant manapun.
  const tenantProjectIds = db
    .select({ id: projects.id })
    .from(projects)
    .where(isPlatformScope(c)
      ? isNull(projects.deletedAt)
      : and(eq(projects.tenantId, tenant.tenantId), isNull(projects.deletedAt)))

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

  // Isolasi via project + soft delete: task dari project yang sudah
  // dihapus tidak ikut tampil/mutasi. Platform scope (hub-admin): semua
  // project aktif tenant manapun.
  const tenantProjectIds = db
    .select({ id: projects.id })
    .from(projects)
    .where(isPlatformScope(c)
      ? isNull(projects.deletedAt)
      : and(eq(projects.tenantId, tenant.tenantId), isNull(projects.deletedAt)))

  const task = await db.query.tasks.findFirst({
    where: and(eq(tasks.id, id), inArray(tasks.projectId, tenantProjectIds)),
  })

  if (!task) return c.json({ error: 'Task not found' }, 404)

  // SECURITY: scope the delete to the task as well as the comment id, so a
  // comment belonging to a task in another tenant can't be deleted by guessing
  // its UUID (IDOR on child table via path param).
  const [deleted] = await db
    .delete(taskComments)
    .where(and(eq(taskComments.id, commentId), eq(taskComments.taskId, id)))
    .returning({ id: taskComments.id })

  if (!deleted) return c.json({ error: 'Comment not found' }, 404)

  return c.json({ message: 'Comment deleted' })
})

tasksRouter.post('/:id/tags', validate(taskTagSchema, 'json'), async (c) => {
  const tenant = c.get('tenant')
  const { id } = c.req.param()
  const { tagId } = getValidated<typeof taskTagSchema>(c, 'json')!

  // Isolasi via project + soft delete: task dari project yang sudah
  // dihapus tidak ikut tampil/mutasi. Platform scope (hub-admin): semua
  // project aktif tenant manapun.
  const tenantProjectIds = db
    .select({ id: projects.id })
    .from(projects)
    .where(isPlatformScope(c)
      ? isNull(projects.deletedAt)
      : and(eq(projects.tenantId, tenant.tenantId), isNull(projects.deletedAt)))

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

  // Isolasi via project + soft delete: task dari project yang sudah
  // dihapus tidak ikut tampil/mutasi. Platform scope (hub-admin): semua
  // project aktif tenant manapun.
  const tenantProjectIds = db
    .select({ id: projects.id })
    .from(projects)
    .where(isPlatformScope(c)
      ? isNull(projects.deletedAt)
      : and(eq(projects.tenantId, tenant.tenantId), isNull(projects.deletedAt)))

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

  // Isolasi via project + soft delete: task dari project yang sudah
  // dihapus tidak ikut tampil/mutasi. Platform scope (hub-admin): semua
  // project aktif tenant manapun.
  const tenantProjectIds = db
    .select({ id: projects.id })
    .from(projects)
    .where(isPlatformScope(c)
      ? isNull(projects.deletedAt)
      : and(eq(projects.tenantId, tenant.tenantId), isNull(projects.deletedAt)))

  const [deleted] = await db
    .update(tasks)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(tasks.id, id), inArray(tasks.projectId, tenantProjectIds)))
    .returning()

  if (!deleted) return c.json({ error: 'Task not found' }, 404)

  if (tenant.tenantId !== '*') await recordAudit(c, tenant.tenantId, {
    action: 'task.delete',
    module: 'projects',
    recordId: id,
    oldValues: { title: deleted.title, projectId: deleted.projectId },
    newValues: { softDelete: true },
  })

  return c.json({ message: 'Task deleted' })
})

export default tasksRouter
