import { pgTable, uuid, varchar, integer, date, text, timestamp } from 'drizzle-orm/pg-core'
import { users } from './users'
import { leaveTypes } from './leave-types'
import { tenants } from './tenants'

export const leaveRequests = pgTable('leave_requests', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }).notNull(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  leaveTypeId: uuid('leave_type_id').references(() => leaveTypes.id, { onDelete: 'cascade' }).notNull(),
  startDate: date('start_date').notNull(),
  endDate: date('end_date').notNull(),
  totalDays: integer('total_days').notNull(),
  reason: text('reason').notNull(),
  attachmentUrl: varchar('attachment_url'),
  status: varchar('status', { length: 20 }).default('pending').notNull(),
  approvedBy: uuid('approved_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

export type LeaveRequest = typeof leaveRequests.$inferSelect
export type NewLeaveRequest = typeof leaveRequests.$inferInsert
