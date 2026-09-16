import { pgTable, uuid, varchar, integer, decimal, timestamp } from 'drizzle-orm/pg-core'
import { tenants } from './tenants'

export const departmentBudgets = pgTable('department_budgets', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }).notNull(),
  department: varchar('department', { length: 100 }).notNull(),
  periodMonth: integer('period_month').notNull(),
  periodYear: integer('period_year').notNull(),
  allocatedBudget: decimal('allocated_budget', { precision: 15, scale: 2 }).notNull(),
  usedBudget: decimal('used_budget', { precision: 15, scale: 2 }).default('0.00').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

export type DepartmentBudget = typeof departmentBudgets.$inferSelect
export type NewDepartmentBudget = typeof departmentBudgets.$inferInsert
