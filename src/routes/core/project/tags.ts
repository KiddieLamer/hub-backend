import { Hono } from 'hono'
import { z } from 'zod'
import { eq, and, inArray } from 'drizzle-orm'
import { db } from '../../../db'
import { taskTags, projects } from '../../../db/schema'
import { authMiddleware, type Variables as AuthVariables } from '../../../middleware/auth'
import { requireModuleAccess } from '../../../middleware/rbac'
import { tenantMiddleware, type TenantVariables } from '../../../middleware/tenant'

type Variables = AuthVariables & TenantVariables

const tagsRouter = new Hono<{ Variables: Variables }>()
tagsRouter.use('*', authMiddleware)
tagsRouter.use('*', tenantMiddleware)
tagsRouter.use('*', requireModuleAccess('projects:read', 'projects:write'))

const createTagSchema = z.object({
  projectId: z.string().uuid(),
  name: z.string().min(1).max(50),
  colorCode: z.string().max(20).default('#EF4444'),
})

tagsRouter.get('/', async (c) => {
  const tenant = c.get('tenant')
  const { projectId } = c.req.query()

  const tenantProjectIds = db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.tenantId, tenant.tenantId))

  const conditions = [inArray(taskTags.projectId, tenantProjectIds)]

  if (projectId) conditions.push(eq(taskTags.projectId, projectId))

  const data = await db.query.taskTags.findMany({
    where: and(...conditions),
    orderBy: (fields, { asc }) => [asc(fields.name)],
  })

  return c.json({ tags: data, total: data.length })
})

tagsRouter.post('/', async (c) => {
  const tenant = c.get('tenant')
  const body = createTagSchema.parse(await c.req.json())

  const tenantProjectIds = db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.tenantId, tenant.tenantId))

  const projectAllowed = await db.query.projects.findFirst({
    where: and(eq(projects.id, body.projectId), inArray(projects.id, tenantProjectIds)),
  })

  if (!projectAllowed) return c.json({ error: 'Project not found' }, 404)

  const [tag] = await db.insert(taskTags).values(body).returning()

  return c.json({ tag }, 201)
})

tagsRouter.patch('/:id', async (c) => {
  const tenant = c.get('tenant')
  const { id } = c.req.param()
  const body = createTagSchema.partial().parse(await c.req.json())

  const tenantProjectIds = db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.tenantId, tenant.tenantId))

  const tag = await db.query.taskTags.findFirst({
    where: and(eq(taskTags.id, id), inArray(taskTags.projectId, tenantProjectIds)),
  })

  if (!tag) return c.json({ error: 'Tag not found' }, 404)

  const [updated] = await db
    .update(taskTags)
    .set({ ...body })
    .where(eq(taskTags.id, id))
    .returning()

  return c.json({ tag: updated })
})

tagsRouter.delete('/:id', async (c) => {
  const tenant = c.get('tenant')
  const { id } = c.req.param()

  const tenantProjectIds = db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.tenantId, tenant.tenantId))

  const tag = await db.query.taskTags.findFirst({
    where: and(eq(taskTags.id, id), inArray(taskTags.projectId, tenantProjectIds)),
  })

  if (!tag) return c.json({ error: 'Tag not found' }, 404)

  await db.delete(taskTags).where(eq(taskTags.id, id))

  return c.json({ message: 'Tag deleted' })
})

export default tagsRouter
