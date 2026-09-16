import { pgTable, uuid, varchar, text, date, decimal, timestamp } from 'drizzle-orm/pg-core'
import { tenants } from './tenants'
import { suppliers } from './suppliers'
import { projects } from './projects'
import { users } from './users'

export const pos = pgTable('pos', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }).notNull(),
  poNumber: varchar('po_number', { length: 100 }).notNull().unique(),
  supplierId: uuid('supplier_id').references(() => suppliers.id, { onDelete: 'restrict' }).notNull(),
  projectId: uuid('project_id').references(() => projects.id, { onDelete: 'set null' }),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'restrict' }).notNull(),
  approvedBy: uuid('approved_by').references(() => users.id, { onDelete: 'set null' }),
  orderDate: date('order_date').notNull(),
  expectedDeliveryDate: date('expected_delivery_date'),
  totalAmount: decimal('total_amount', { precision: 15, scale: 2 }).default('0.00').notNull(),
  status: varchar('status', { length: 50 }).default('draft').notNull(),
  notes: text('notes'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

export type PurchaseOrder = typeof pos.$inferSelect
export type NewPurchaseOrder = typeof pos.$inferInsert
