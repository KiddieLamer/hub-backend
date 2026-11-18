import { Hono } from 'hono'
import { z } from 'zod'
import { eq, and, desc } from 'drizzle-orm'
import { db } from '../../../db'
import {
  financeScenarios,
  financeDeposits,
  financeTaxCodes,
  financePayrollComponents,
  financeCompensations,
  financeBusinessCases,
  financeRisks,
  clients,
} from '../../../db/schema'
import { authMiddleware, type Variables as AuthVariables } from '../../../middleware/auth'
import { requireModuleAccess } from '../../../middleware/rbac'
import { tenantMiddleware, type TenantVariables } from '../../../middleware/tenant'
import { validate, getValidated } from '../../../middleware/validate'
import { isNull } from 'drizzle-orm'

type Variables = AuthVariables & TenantVariables

// ======================================================================
// Factory CRUD tenant-scoped untuk entitas pelengkap Finance.
// Semua mutasi WAJIB lewat validate() (pelajaran F-FIN-8) dan list/
// patch/delete selalu difilter tenantId (isolasi tenant).
// ======================================================================

interface ExtraEntity {
  path: string
  key: string
  singular: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  table: any
  schema: z.ZodTypeAny
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  values: (b: Record<string, any>) => Record<string, unknown>
  /** Validasi tambahan pra-create (mis. kepemilikan clientId) → pesan error atau null. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  preCreate?: (b: Record<string, any>, tenantId: string) => Promise<string | null>
}

const ENTITIES: ExtraEntity[] = [
  {
    path: '/scenarios', key: 'scenarios', singular: 'scenario', table: financeScenarios,
    schema: z.object({
      name: z.string().min(1).max(100),
      revenueTarget: z.number().min(0),
      costTarget: z.number().min(0),
      assumption: z.string().max(255).optional(),
    }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    values: (b: Record<string, any>) => ({
      name: b.name,
      revenueTarget: String(b.revenueTarget),
      costTarget: String(b.costTarget),
      assumption: b.assumption ?? null,
    }),
  },
  {
    path: '/deposits', key: 'deposits', singular: 'deposit', table: financeDeposits,
    schema: z.object({
      clientId: z.string().uuid().nullable().optional(),
      depositDate: z.string(),
      amount: z.number().min(0),
      isAllocated: z.boolean().default(false),
      notes: z.string().optional(),
    }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    values: (b: Record<string, any>) => ({
      clientId: b.clientId ?? null,
      depositDate: b.depositDate,
      amount: String(b.amount),
      isAllocated: b.isAllocated ?? false,
      notes: b.notes ?? null,
    }),
    preCreate: async (b, tenantId) => {
      if (!b.clientId) return null
      const client = await db.query.clients.findFirst({
        where: and(eq(clients.id, b.clientId), eq(clients.tenantId, tenantId), isNull(clients.deletedAt)),
      })
      return client ? null : 'Client not found in this tenant'
    },
  },
  {
    path: '/tax-codes', key: 'taxCodes', singular: 'taxCode', table: financeTaxCodes,
    schema: z.object({
      code: z.string().min(1).max(50),
      name: z.string().min(1).max(255),
      type: z.enum(['ppn', 'pph', 'lainnya']).default('ppn'),
      rate: z.number().min(0).max(100),
      isActive: z.boolean().default(true),
    }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    values: (b: Record<string, any>) => ({
      code: b.code, name: b.name, type: b.type, rate: String(b.rate), isActive: b.isActive ?? true,
    }),
  },
  {
    path: '/payroll-components', key: 'payrollComponents', singular: 'payrollComponent', table: financePayrollComponents,
    schema: z.object({
      name: z.string().min(1).max(255),
      type: z.enum(['pendapatan', 'potongan']).default('pendapatan'),
      rule: z.string().max(255).optional(),
      isActive: z.boolean().default(true),
    }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    values: (b: Record<string, any>) => ({
      name: b.name, type: b.type, rule: b.rule ?? null, isActive: b.isActive ?? true,
    }),
  },
  {
    path: '/compensations', key: 'compensations', singular: 'compensation', table: financeCompensations,
    schema: z.object({
      employeeName: z.string().min(1).max(255),
      currentSalary: z.number().min(0),
      proposedSalary: z.number().min(0),
      status: z.enum(['review', 'approved', 'rejected']).default('review'),
    }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    values: (b: Record<string, any>) => ({
      employeeName: b.employeeName, currentSalary: String(b.currentSalary),
      proposedSalary: String(b.proposedSalary), status: b.status,
    }),
  },
  {
    path: '/business-cases', key: 'businessCases', singular: 'businessCase', table: financeBusinessCases,
    schema: z.object({
      name: z.string().min(1).max(255),
      investment: z.number().min(0),
      npv: z.number(),
      status: z.enum(['review', 'approved', 'rejected', 'ditunda']).default('review'),
    }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    values: (b: Record<string, any>) => ({
      name: b.name, investment: String(b.investment), npv: String(b.npv), status: b.status,
    }),
  },
  {
    path: '/risks', key: 'risks', singular: 'risk', table: financeRisks,
    schema: z.object({
      name: z.string().min(1).max(255),
      impactAmount: z.number().min(0),
      impactLevel: z.number().int().min(0).max(2),
      probability: z.number().int().min(0).max(2),
      status: z.enum(['review', 'approved', 'rejected']).default('review'),
    }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    values: (b: Record<string, any>) => ({
      name: b.name, impactAmount: String(b.impactAmount),
      impactLevel: b.impactLevel, probability: b.probability, status: b.status,
    }),
  },
]

function buildEntityRouter(entity: ExtraEntity) {
  const r = new Hono<{ Variables: Variables }>()
  r.use('*', authMiddleware)
  r.use('*', tenantMiddleware)
  r.use('*', requireModuleAccess('finance:read', 'finance:write'))

  r.get('/', async (c) => {
    const tenant = c.get('tenant')
    const rows = await db
      .select()
      .from(entity.table)
      .where(eq(entity.table.tenantId, tenant.tenantId))
      .orderBy(desc(entity.table.createdAt))
    return c.json({ [entity.key]: rows, total: rows.length })
  })

  r.post('/', validate(entity.schema, 'json'), async (c) => {
    const tenant = c.get('tenant')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body = getValidated<any>(c, 'json')!
    if (entity.preCreate) {
      const err = await entity.preCreate(body, tenant.tenantId)
      if (err) return c.json({ error: err }, 400)
    }
    const [row] = await db
      .insert(entity.table)
      .values({ ...entity.values(body), tenantId: tenant.tenantId })
      .returning()
    return c.json({ [entity.singular]: row }, 201)
  })

  // PATCH = full replace (body lengkap) — simpel dan konsisten untuk toggle FE.
  r.patch('/:id', validate(entity.schema, 'json'), async (c) => {
    const tenant = c.get('tenant')
    const { id } = c.req.param()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body = getValidated<any>(c, 'json')!
    const [row] = await db
      .update(entity.table)
      .set({ ...entity.values(body), updatedAt: new Date() })
      .where(and(eq(entity.table.id, id), eq(entity.table.tenantId, tenant.tenantId)))
      .returning()
    if (!row) return c.json({ error: 'Not found' }, 404)
    return c.json({ [entity.singular]: row })
  })

  r.delete('/:id', async (c) => {
    const tenant = c.get('tenant')
    const { id } = c.req.param()
    const [row] = await db
      .delete(entity.table)
      .where(and(eq(entity.table.id, id), eq(entity.table.tenantId, tenant.tenantId)))
      .returning()
    if (!row) return c.json({ error: 'Not found' }, 404)
    return c.json({ message: 'Deleted' })
  })

  return r
}

export const financeScenariosRouter = buildEntityRouter(ENTITIES[0])
export const financeDepositsRouter = buildEntityRouter(ENTITIES[1])
export const financeTaxCodesRouter = buildEntityRouter(ENTITIES[2])
export const financePayrollComponentsRouter = buildEntityRouter(ENTITIES[3])
export const financeCompensationsRouter = buildEntityRouter(ENTITIES[4])
export const financeBusinessCasesRouter = buildEntityRouter(ENTITIES[5])
export const financeRisksRouter = buildEntityRouter(ENTITIES[6])
