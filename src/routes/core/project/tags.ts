import { Hono } from 'hono'
import { z } from 'zod'
import { eq, and, inArray, isNull, SQL, count } from 'drizzle-orm'
import { db } from '../../../db'
import { taskTags, projects } from '../../../db/schema'
import { authMiddleware, type Variables as AuthVariables } from '../../../middleware/auth'
import { requireModuleAccess } from '../../../middleware/rbac'
import { tenantMiddleware, type TenantVariables } from '../../../middleware/tenant'
import { parsePagination, paginated } from '../../../lib/pagination'
import { validate, getValidated } from '../../../middleware/validate'

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

const updateTagSchema = createTagSchema.partial()

// Platform scope — sama dengan projects.ts/clients.ts.
function isPlatformScope(c: any): boolean {
  const user = c.get('user')
  if (user?.platformRole !== 'hub-admin') return false
  const headerScope = c.req.header('X-Platform-Scope')
  if (headerScope === 'all') return true
  const queryScope = c.req.query('scope')
  return queryScope === 'all'
}

tagsRouter.get('/', async (c) => {
  const tenant = c.get('tenant')
  const { projectId } = c.req.query()
  const pagination = parsePagination(c)

  // Isolasi via project + soft delete (tag project terhapus ikut tersembunyi).
  const tenantProjectIds = db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.tenantId, tenant.tenantId), isNull(projects.deletedAt)))

  // Platform scope (hub-admin): gabungan tags semua tenant.
  const conditions: SQL[] = isPlatformScope(c)
    ? []
    : [inArray(taskTags.projectId, tenantProjectIds)]

  if (projectId) conditions.push(eq(taskTags.projectId, projectId))

  const where = and(...conditions)

  const [data, [{ value: total }]] = await Promise.all([
    db.query.taskTags.findMany({
      where,
      orderBy: (fields, { asc }) => [asc(fields.name)],
      limit: pagination.limit,
      offset: pagination.offset,
    }),
    db.select({ value: count() }).from(taskTags).where(where),
  ])

  return c.json(paginated('tags', data, Number(total), pagination))
})

tagsRouter.post('/', validate(createTagSchema, 'json'), async (c) => {
  const tenant = c.get('tenant')
  const body = getValidated<typeof createTagSchema>(c, 'json')!

  // Isolasi via project + soft delete (tag project terhapus ikut tersembunyi).
  const tenantProjectIds = db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.tenantId, tenant.tenantId), isNull(projects.deletedAt)))

  const projectAllowed = await db.query.projects.findFirst({
    where: and(eq(projects.id, body.projectId), inArray(projects.id, tenantProjectIds)),
  })

  if (!projectAllowed) return c.json({ error: 'Project not found' }, 404)

  const [tag] = await db.insert(taskTags).values(body).returning()

  return c.json({ tag }, 201)
})

tagsRouter.patch('/:id', validate(updateTagSchema, 'json'), async (c) => {
  const tenant = c.get('tenant')
  const { id } = c.req.param()
  const body = getValidated<typeof updateTagSchema>(c, 'json')!

  // Isolasi via project + soft delete (tag project terhapus ikut tersembunyi).
  const tenantProjectIds = db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.tenantId, tenant.tenantId), isNull(projects.deletedAt)))

  const tag = await db.query.taskTags.findFirst({
    where: and(eq(taskTags.id, id), inArray(taskTags.projectId, tenantProjectIds)),
  })

  if (!tag) return c.json({ error: 'Tag not found' }, 404)

  // SECURITY: scope by tenant (via project subquery) on top of the pre-check,
  // so an id from another tenant can never be mutated (defense-in-depth).
  const [updated] = await db
    .update(taskTags)
    .set({ ...body })
    .where(and(eq(taskTags.id, id), inArray(taskTags.projectId, tenantProjectIds)))
    .returning()

  return c.json({ tag: updated })
})

tagsRouter.delete('/:id', async (c) => {
  const tenant = c.get('tenant')
  const { id } = c.req.param()

  // Isolasi via project + soft delete (tag project terhapus ikut tersembunyi).
  const tenantProjectIds = db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.tenantId, tenant.tenantId), isNull(projects.deletedAt)))

  const tag = await db.query.taskTags.findFirst({
    where: and(eq(taskTags.id, id), inArray(taskTags.projectId, tenantProjectIds)),
  })

  if (!tag) return c.json({ error: 'Tag not found' }, 404)

  // SECURITY: scope delete by tenant (via project subquery), not just id.
  await db
    .delete(taskTags)
    .where(and(eq(taskTags.id, id), inArray(taskTags.projectId, tenantProjectIds)))

  return c.json({ message: 'Tag deleted' })
})

export default tagsRouter
