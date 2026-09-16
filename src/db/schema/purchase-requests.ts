import { pgTable, uuid, varchar, text, decimal, timestamp } from 'drizzle-orm/pg-core'
import { tenants } from './tenants'
import { users } from './users'

export const purchaseRequests = pgTable('purchase_requests', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }).notNull(),
  prNumber: varchar('pr_number', { length: 100 }).notNull().unique(),
  requesterId: uuid('requester_id').references(() => users.id, { onDelete: 'restrict' }).notNull(),
  department: varchar('department', { length: 100 }).notNull(),
  title: varchar('title', { length: 255 }).notNull(),
  priority: varchar('priority', { length: 20 }).default('medium').notNull(),
  estimatedTotalCost: decimal('estimated_total_cost', { precision: 15, scale: 2 }).default('0.00').notNull(),
  status: varchar('status', { length: 50 }).default('draft').notNull(),
  approvedBy: uuid('approved_by').references(() => users.id, { onDelete: 'set null' }),
  approvalDate: timestamp('approval_date'),
  rejectionReason: text('rejection_reason'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  deletedAt: timestamp('deleted_at'),
})

export type PurchaseRequest = typeof purchaseRequests.$inferSelect
export type NewPurchaseRequest = typeof purchaseRequests.$inferInsert
