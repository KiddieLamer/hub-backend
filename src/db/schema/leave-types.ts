import { pgTable, uuid, varchar, boolean, integer, timestamp } from 'drizzle-orm/pg-core'
import { tenants } from './tenants'

export const leaveTypes = pgTable('leave_types', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }).notNull(),
  name: varchar('name', { length: 100 }).notNull(),
  isPaid: boolean('is_paid').default(true).notNull(),
  totalQuota: integer('total_quota').notNull(),
  description: varchar('description', { length: 500 }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

export type LeaveType = typeof leaveTypes.$inferSelect
export type NewLeaveType = typeof leaveTypes.$inferInsert
