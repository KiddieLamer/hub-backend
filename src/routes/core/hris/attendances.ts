import { Hono } from 'hono'
import { z } from 'zod'
import { eq, and, gte, lte, SQL } from 'drizzle-orm'
import { db } from '../../../db'
import { attendances } from '../../../db/schema'
import { authMiddleware, type Variables as AuthVariables } from '../../../middleware/auth'
import { requireModuleAccess } from '../../../middleware/rbac'
import { tenantMiddleware, type TenantVariables } from '../../../middleware/tenant'

type Variables = AuthVariables & TenantVariables

const attendancesRouter = new Hono<{ Variables: Variables }>()
attendancesRouter.use('*', authMiddleware)
attendancesRouter.use('*', tenantMiddleware)
attendancesRouter.use('*', requireModuleAccess('hris:read', 'hris:write'))

const checkInSchema = z.object({
  clockIn: z.string().optional(),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
  photoUrl: z.string().optional(),
})

const checkOutSchema = z.object({
  clockOut: z.string().optional(),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
  photoUrl: z.string().optional(),
})

attendancesRouter.get('/', async (c) => {
  const tenant = c.get('tenant')
  const { userId, startDate, endDate } = c.req.query()

  const conditions: SQL[] = [eq(attendances.tenantId, tenant.tenantId)]
  if (userId) conditions.push(eq(attendances.userId, userId))
  if (startDate) conditions.push(gte(attendances.attendanceDate, startDate))
  if (endDate) conditions.push(lte(attendances.attendanceDate, endDate))

  const whereClause = and(...conditions)

  const data = await db.query.attendances.findMany({
    where: whereClause,
    orderBy: (fields, { desc }) => [desc(fields.attendanceDate)],
  })

  return c.json({ attendances: data })
})

attendancesRouter.post('/check-in', async (c) => {
  const tenant = c.get('tenant')
  const authUser = c.get('user')
  const { latitude, longitude, photoUrl } = checkInSchema.parse(await c.req.json())

  const today = new Date().toISOString().split('T')[0]

  const existing = await db.query.attendances.findFirst({
    where: and(
      eq(attendances.tenantId, tenant.tenantId),
      eq(attendances.userId, authUser.id),
      eq(attendances.attendanceDate, today)
    ),
  })

  if (existing) {
    return c.json({ error: 'Already checked in today' }, 400)
  }

  const [attendance] = await db.insert(attendances).values({
    tenantId: tenant.tenantId,
    userId: authUser.id,
    attendanceDate: today,
    checkInTime: new Date(),
    checkInLatLong: latitude && longitude ? `${latitude},${longitude}` : null,
    checkInPhotoUrl: photoUrl,
  }).returning()

  return c.json({ attendance }, 201)
})

attendancesRouter.post('/check-out', async (c) => {
  const tenant = c.get('tenant')
  const authUser = c.get('user')
  const { latitude, longitude, photoUrl } = checkOutSchema.parse(await c.req.json())

  const today = new Date().toISOString().split('T')[0]

  const existing = await db.query.attendances.findFirst({
    where: and(
      eq(attendances.tenantId, tenant.tenantId),
      eq(attendances.userId, authUser.id),
      eq(attendances.attendanceDate, today)
    ),
  })

  if (!existing) {
    return c.json({ error: 'No check-in found today' }, 400)
  }

  if (existing.checkOutTime) {
    return c.json({ error: 'Already checked out today' }, 400)
  }

  const [updated] = await db
    .update(attendances)
    .set({
      checkOutTime: new Date(),
      checkOutLatLong: latitude && longitude ? `${latitude},${longitude}` : null,
      checkOutPhotoUrl: photoUrl,
      updatedAt: new Date(),
    })
    .where(eq(attendances.id, existing.id))
    .returning()

  return c.json({ attendance: updated })
})

export default attendancesRouter
