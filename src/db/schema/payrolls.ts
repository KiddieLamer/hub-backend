import { pgTable, uuid, varchar, integer, decimal, timestamp } from 'drizzle-orm/pg-core'
import { users } from './users'
import { tenants } from './tenants'

export const payrolls = pgTable('payrolls', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }).notNull(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  periodMonth: integer('period_month').notNull(),
  periodYear: integer('period_year').notNull(),
  basicSalary: decimal('basic_salary', { precision: 15, scale: 2 }).notNull(),
  totalAllowances: decimal('total_allowances', { precision: 15, scale: 2 }).default('0.00').notNull(),
  totalDeductions: decimal('total_deductions', { precision: 15, scale: 2 }).default('0.00').notNull(),
  netSalary: decimal('net_salary', { precision: 15, scale: 2 }).notNull(),
  status: varchar('status', { length: 20 }).default('draft').notNull(),
  approvedBy: uuid('approved_by').references(() => users.id, { onDelete: 'set null' }),
  paidAt: timestamp('paid_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

export type Payroll = typeof payrolls.$inferSelect
export type NewPayroll = typeof payrolls.$inferInsert
