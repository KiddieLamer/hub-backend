import { pgTable, uuid, varchar, date, time, decimal, timestamp } from 'drizzle-orm/pg-core'
import { users } from './users'
import { tenants } from './tenants'

export const overtimeRequests = pgTable('overtime_requests', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }).notNull(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  overtimeDate: date('overtime_date').notNull(),
  startTime: time('start_time').notNull(),
  endTime: time('end_time').notNull(),
  totalHours: decimal('total_hours', { precision: 4, scale: 2 }).notNull(),
  multiplierRate: decimal('multiplier_rate', { precision: 3, scale: 2 }).default('1.50').notNull(),
  status: varchar('status', { length: 20 }).default('pending').notNull(),
  approvedBy: uuid('approved_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

export type OvertimeRequest = typeof overtimeRequests.$inferSelect
export type NewOvertimeRequest = typeof overtimeRequests.$inferInsert
