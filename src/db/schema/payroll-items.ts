import { pgTable, uuid, varchar, decimal, timestamp } from 'drizzle-orm/pg-core'
import { payrolls } from './payrolls'
import { tenants } from './tenants'

export const payrollItems = pgTable('payroll_items', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }).notNull(),
  payrollId: uuid('payroll_id').references(() => payrolls.id, { onDelete: 'cascade' }).notNull(),
  itemType: varchar('item_type', { length: 20 }).notNull(),
  itemName: varchar('item_name', { length: 100 }).notNull(),
  amount: decimal('amount', { precision: 15, scale: 2 }).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

export type PayrollItem = typeof payrollItems.$inferSelect
export type NewPayrollItem = typeof payrollItems.$inferInsert
