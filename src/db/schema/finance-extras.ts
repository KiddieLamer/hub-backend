import { pgTable, uuid, varchar, text, boolean, integer, decimal, date, timestamp } from 'drizzle-orm/pg-core'
import { tenants } from './tenants'
import { clients } from './clients'

// ======================================================================
// Tabel pelengkap window Finance (19 Nov 2026) — satu entitas per
// halaman yang sebelumnya mock. Semua tenant-scoped, tanpa soft delete
// (data pendukung laporan, bukan dokumen fisikal).
// ======================================================================

/** Scenario & Forecast — skenario anggaran best/base/worst. */
export const financeScenarios = pgTable('finance_scenarios', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }).notNull(),
  name: varchar('name', { length: 100 }).notNull(),
  revenueTarget: decimal('revenue_target', { precision: 15, scale: 2 }).default('0.00').notNull(),
  costTarget: decimal('cost_target', { precision: 15, scale: 2 }).default('0.00').notNull(),
  assumption: varchar('assumption', { length: 255 }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

/** Deposit & Advance — uang muka pelanggan. */
export const financeDeposits = pgTable('finance_deposits', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }).notNull(),
  clientId: uuid('client_id').references(() => clients.id, { onDelete: 'set null' }),
  depositDate: date('deposit_date').notNull(),
  amount: decimal('amount', { precision: 15, scale: 2 }).notNull(),
  isAllocated: boolean('is_allocated').default(false).notNull(),
  notes: text('notes'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

/** Tax Setup — kode pajak tenant (PPN/PPh dsb). */
export const financeTaxCodes = pgTable('finance_tax_codes', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }).notNull(),
  code: varchar('code', { length: 50 }).notNull(),
  name: varchar('name', { length: 255 }).notNull(),
  type: varchar('type', { length: 30 }).default('ppn').notNull(),
  rate: decimal('rate', { precision: 5, scale: 2 }).notNull(),
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

/** Payroll Components & Rules — komponen gaji tenant. */
export const financePayrollComponents = pgTable('finance_payroll_components', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }).notNull(),
  name: varchar('name', { length: 255 }).notNull(),
  type: varchar('type', { length: 30 }).default('pendapatan').notNull(),
  rule: varchar('rule', { length: 255 }),
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

/** Compensation Review — usulan kenaikan gaji. */
export const financeCompensations = pgTable('finance_compensations', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }).notNull(),
  employeeName: varchar('employee_name', { length: 255 }).notNull(),
  currentSalary: decimal('current_salary', { precision: 15, scale: 2 }).notNull(),
  proposedSalary: decimal('proposed_salary', { precision: 15, scale: 2 }).notNull(),
  status: varchar('status', { length: 30 }).default('review').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

/** Business Case — proposal investasi (NPV). */
export const financeBusinessCases = pgTable('finance_business_cases', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }).notNull(),
  name: varchar('name', { length: 255 }).notNull(),
  investment: decimal('investment', { precision: 15, scale: 2 }).notNull(),
  npv: decimal('npv', { precision: 15, scale: 2 }).default('0.00').notNull(),
  status: varchar('status', { length: 30 }).default('review').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

/** Risk & Decision — register risiko (dampak × probabilitas). */
export const financeRisks = pgTable('finance_risks', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }).notNull(),
  name: varchar('name', { length: 255 }).notNull(),
  impactAmount: decimal('impact_amount', { precision: 15, scale: 2 }).default('0.00').notNull(),
  impactLevel: integer('impact_level').default(1).notNull(),
  probability: integer('probability').default(1).notNull(),
  status: varchar('status', { length: 30 }).default('review').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

export type FinanceScenario = typeof financeScenarios.$inferSelect
export type FinanceDeposit = typeof financeDeposits.$inferSelect
export type FinanceTaxCode = typeof financeTaxCodes.$inferSelect
export type FinancePayrollComponent = typeof financePayrollComponents.$inferSelect
export type FinanceCompensation = typeof financeCompensations.$inferSelect
export type FinanceBusinessCase = typeof financeBusinessCases.$inferSelect
export type FinanceRisk = typeof financeRisks.$inferSelect
