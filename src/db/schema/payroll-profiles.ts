import { pgTable, uuid, varchar, decimal, boolean, timestamp } from 'drizzle-orm/pg-core'
import { users } from './users'
import { tenants } from './tenants'

export const payrollProfiles = pgTable('payroll_profiles', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }).notNull(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull().unique(),
  basicSalary: decimal('basic_salary', { precision: 15, scale: 2 }).notNull(),
  bankName: varchar('bank_name', { length: 50 }),
  bankAccountNumber: varchar('bank_account_number', { length: 50 }),
  ptkpStatus: varchar('ptkp_status', { length: 10 }).default('TK/0').notNull(),
  npwpNumber: varchar('npwp_number', { length: 50 }),
  bpjsTkNumber: varchar('bpjs_tk_number', { length: 50 }),
  bpjsKesNumber: varchar('bpjs_kes_number', { length: 50 }),
  isBpjsTkActive: boolean('is_bpjs_tk_active').default(true).notNull(),
  isBpjsKesActive: boolean('is_bpjs_kes_active').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

export type PayrollProfile = typeof payrollProfiles.$inferSelect
export type NewPayrollProfile = typeof payrollProfiles.$inferInsert
