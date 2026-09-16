import { pgTable, uuid, varchar, date, decimal, timestamp } from 'drizzle-orm/pg-core'
import { tenants } from './tenants'
import { purchaseRequests } from './purchase-requests'
import { vendors } from './vendors'
import { users } from './users'

export const purchaseOrders = pgTable('purchase_orders', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }).notNull(),
  poNumber: varchar('po_number', { length: 100 }).notNull().unique(),
  prId: uuid('pr_id').references(() => purchaseRequests.id, { onDelete: 'set null' }),
  vendorId: uuid('vendor_id').references(() => vendors.id, { onDelete: 'restrict' }).notNull(),
  issuedBy: uuid('issued_by').references(() => users.id, { onDelete: 'restrict' }).notNull(),
  subtotal: decimal('subtotal', { precision: 15, scale: 2 }).notNull(),
  taxAmount: decimal('tax_amount', { precision: 15, scale: 2 }).default('0.00').notNull(),
  discountAmount: decimal('discount_amount', { precision: 15, scale: 2 }).default('0.00').notNull(),
  grandTotal: decimal('grand_total', { precision: 15, scale: 2 }).notNull(),
  paymentTerms: varchar('payment_terms', { length: 100 }),
  status: varchar('status', { length: 50 }).default('draft').notNull(),
  expectedDeliveryDate: date('expected_delivery_date'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  deletedAt: timestamp('deleted_at'),
})

export type PurchaseOrder = typeof purchaseOrders.$inferSelect
export type NewPurchaseOrder = typeof purchaseOrders.$inferInsert
