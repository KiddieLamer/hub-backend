import { Hono } from 'hono'
import { eq, and, SQL, ilike } from 'drizzle-orm'
import { db } from '../../../db'
import { systemAuditLogs } from '../../../db/schema'
import { authMiddleware, type Variables as AuthVariables } from '../../../middleware/auth'
import { tenantMiddleware, type TenantVariables } from '../../../middleware/tenant'

type Variables = AuthVariables & TenantVariables

const auditLogsRouter = new Hono<{ Variables: Variables }>()
auditLogsRouter.use('*', authMiddleware)
auditLogsRouter.use('*', tenantMiddleware)

// List audit logs
auditLogsRouter.get('/', async (c) => {
  const tenant = c.get('tenant')
  const { module, action, userId, page = '1', limit = '50' } = c.req.query()

  const conditions: SQL[] = [eq(systemAuditLogs.tenantId, tenant.tenantId)]

  if (module) conditions.push(eq(systemAuditLogs.module, module))
  if (action) conditions.push(ilike(systemAuditLogs.action, `%${action}%`))
  if (userId) conditions.push(eq(systemAuditLogs.userId, userId))

  const offset = (Number(page) - 1) * Number(limit)

  const data = await db.query.systemAuditLogs.findMany({
    where: and(...conditions),
    orderBy: (fields, { desc }) => [desc(fields.createdAt)],
    limit: Number(limit),
    offset,
  })

  return c.json({ logs: data, total: data.length, page: Number(page), limit: Number(limit) })
})

// Get log detail
auditLogsRouter.get('/:id', async (c) => {
  const tenant = c.get('tenant')
  const { id } = c.req.param()

  const log = await db.query.systemAuditLogs.findFirst({
    where: and(eq(systemAuditLogs.id, id), eq(systemAuditLogs.tenantId, tenant.tenantId)),
  })

  if (!log) return c.json({ error: 'Audit log not found' }, 404)

  return c.json({ log })
})

// Create log (system use only - requires admin role)
auditLogsRouter.post('/', async (c) => {
  const tenant = c.get('tenant')
  const authUser = c.get('user')

  if (!authUser?.roles?.includes('admin')) {
    return c.json({ error: 'Forbidden' }, 403)
  }

  const body = await c.req.json()

  const [log] = await db.insert(systemAuditLogs).values({
    tenantId: tenant.tenantId,
    userId: authUser?.id || null,
    action: body.action,
    module: body.module,
    recordId: body.recordId || null,
    ipAddress: c.req.header('x-forwarded-for') || c.req.header('x-real-ip') || null,
    userAgent: c.req.header('user-agent') || null,
    oldValues: body.oldValues ? JSON.stringify(body.oldValues) : null,
    newValues: body.newValues ? JSON.stringify(body.newValues) : null,
  }).returning()

  return c.json({ log }, 201)
})

export default auditLogsRouter
