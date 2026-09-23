import { Hono } from 'hono'
import { z } from 'zod'
import { eq, and, SQL } from 'drizzle-orm'
import { db } from '../../../db'
import { payrollProfiles, payrolls, payrollItems } from '../../../db/schema'
import { authMiddleware, type Variables as AuthVariables } from '../../../middleware/auth'
import { requireModuleAccess } from '../../../middleware/rbac'
import { tenantMiddleware, type TenantVariables } from '../../../middleware/tenant'

type Variables = AuthVariables & TenantVariables

const payrollRouter = new Hono<{ Variables: Variables }>()
payrollRouter.use('*', authMiddleware)
payrollRouter.use('*', tenantMiddleware)
payrollRouter.use('*', requireModuleAccess('hris:read', 'hris:write'))

const payrollProfileSchema = z.object({
  basicSalary: z.number().min(0),
  bankName: z.string().max(50).optional(),
  bankAccountNumber: z.string().max(50).optional(),
  ptkpStatus: z.string().max(10).default('TK/0'),
  npwpNumber: z.string().max(50).optional(),
  bpjsTkNumber: z.string().max(50).optional(),
  bpjsKesNumber: z.string().max(50).optional(),
  isBpjsTkActive: z.boolean().default(true),
  isBpjsKesActive: z.boolean().default(true),
})

// Payroll Profile
payrollRouter.get('/profile', async (c) => {
  const tenant = c.get('tenant')
  const authUser = c.get('user')
  const profile = await db.query.payrollProfiles.findFirst({
    where: and(eq(payrollProfiles.tenantId, tenant.tenantId), eq(payrollProfiles.userId, authUser.id)),
  })
  return c.json({ profile })
})

payrollRouter.post('/profile', async (c) => {
  const tenant = c.get('tenant')
  const authUser = c.get('user')
  const body = payrollProfileSchema.parse(await c.req.json())

  const existing = await db.query.payrollProfiles.findFirst({
    where: and(eq(payrollProfiles.tenantId, tenant.tenantId), eq(payrollProfiles.userId, authUser.id)),
  })

  if (existing) {
    const [updated] = await db
      .update(payrollProfiles)
      .set({
        basicSalary: String(body.basicSalary),
        bankName: body.bankName,
        bankAccountNumber: body.bankAccountNumber,
        ptkpStatus: body.ptkpStatus,
        npwpNumber: body.npwpNumber,
        bpjsTkNumber: body.bpjsTkNumber,
        bpjsKesNumber: body.bpjsKesNumber,
        isBpjsTkActive: body.isBpjsTkActive,
        isBpjsKesActive: body.isBpjsKesActive,
        updatedAt: new Date(),
      })
      .where(and(eq(payrollProfiles.tenantId, tenant.tenantId), eq(payrollProfiles.userId, authUser.id)))
      .returning()
    return c.json({ profile: updated })
  }

  const [profile] = await db.insert(payrollProfiles).values({
    tenantId: tenant.tenantId,
    userId: authUser.id,
    basicSalary: String(body.basicSalary),
    bankName: body.bankName,
    bankAccountNumber: body.bankAccountNumber,
    ptkpStatus: body.ptkpStatus,
    npwpNumber: body.npwpNumber,
    bpjsTkNumber: body.bpjsTkNumber,
    bpjsKesNumber: body.bpjsKesNumber,
    isBpjsTkActive: body.isBpjsTkActive,
    isBpjsKesActive: body.isBpjsKesActive,
  }).returning()

  return c.json({ profile }, 201)
})

const createPayrollSchema = z.object({
  periodMonth: z.number().min(1).max(12),
  periodYear: z.number().min(2000),
  basicSalary: z.number().min(0),
  totalAllowances: z.number().min(0).default(0),
  totalDeductions: z.number().min(0).default(0),
  netSalary: z.number().min(0),
  status: z.enum(['draft', 'processed', 'paid']).default('draft'),
})

payrollRouter.post('/', async (c) => {
  const tenant = c.get('tenant')
  const authUser = c.get('user')
  const body = createPayrollSchema.parse(await c.req.json())

  const [payroll] = await db.insert(payrolls).values({
    tenantId: tenant.tenantId,
    userId: authUser.id,
    periodMonth: body.periodMonth,
    periodYear: body.periodYear,
    basicSalary: String(body.basicSalary),
    totalAllowances: String(body.totalAllowances),
    totalDeductions: String(body.totalDeductions),
    netSalary: String(body.netSalary),
    status: body.status,
  }).returning()

  return c.json({ payroll }, 201)
})

payrollRouter.patch('/:id', async (c) => {
  const tenant = c.get('tenant')
  const { id } = c.req.param()
  const body = createPayrollSchema.partial().parse(await c.req.json())

  const [updated] = await db
    .update(payrolls)
    .set({
      ...body,
      basicSalary: body.basicSalary ? String(body.basicSalary) : undefined,
      totalAllowances: body.totalAllowances ? String(body.totalAllowances) : undefined,
      totalDeductions: body.totalDeductions ? String(body.totalDeductions) : undefined,
      netSalary: body.netSalary ? String(body.netSalary) : undefined,
      updatedAt: new Date(),
    })
    .where(and(eq(payrolls.id, id), eq(payrolls.tenantId, tenant.tenantId)))
    .returning()

  if (!updated) {
    return c.json({ error: 'Payroll not found' }, 404)
  }

  return c.json({ payroll: updated })
})

payrollRouter.delete('/:id', async (c) => {
  const tenant = c.get('tenant')
  const { id } = c.req.param()

  const [deleted] = await db
    .delete(payrolls)
    .where(and(eq(payrolls.id, id), eq(payrolls.tenantId, tenant.tenantId)))
    .returning({ id: payrolls.id })

  if (!deleted) {
    return c.json({ error: 'Payroll not found' }, 404)
  }

  return c.json({ message: 'Payroll deleted' })
})

// Payroll
payrollRouter.get('/', async (c) => {
  const tenant = c.get('tenant')
  const authUser = c.get('user')
  const { month, year } = c.req.query()

  const conditions: SQL[] = [eq(payrolls.tenantId, tenant.tenantId), eq(payrolls.userId, authUser.id)]
  if (month) conditions.push(eq(payrolls.periodMonth, parseInt(month)))
  if (year) conditions.push(eq(payrolls.periodYear, parseInt(year)))

  const data = await db.query.payrolls.findMany({
    where: and(...conditions),
    orderBy: (fields, { desc }) => [desc(fields.periodYear), desc(fields.periodMonth)],
  })

  return c.json({ payrolls: data })
})

payrollRouter.get('/:id', async (c) => {
  const tenant = c.get('tenant')
  const { id } = c.req.param()
  const payroll = await db.query.payrolls.findFirst({
    where: and(eq(payrolls.id, id), eq(payrolls.tenantId, tenant.tenantId)),
  })

  if (!payroll) {
    return c.json({ error: 'Payroll not found' }, 404)
  }

  const items = await db.query.payrollItems.findMany({
    where: eq(payrollItems.payrollId, id),
  })

  return c.json({ payroll, items })
})

export default payrollRouter
