import { pgTable, uuid, varchar, text, date, decimal, timestamp } from 'drizzle-orm/pg-core'
import { tenants } from './tenants'
import { clients } from './clients'
import { users } from './users'
import { invoices } from './invoices'

export const quotations = pgTable('quotations', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }).notNull(),
  quotationNumber: varchar('quotation_number', { length: 100 }).notNull().unique(),
  clientId: uuid('client_id').references(() => clients.id, { onDelete: 'restrict' }).notNull(),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'restrict' }).notNull(),
  title: varchar('title', { length: 255 }).notNull(),
  issueDate: date('issue_date').notNull(),
  validUntil: date('valid_until').notNull(),
  subtotal: decimal('subtotal', { precision: 15, scale: 2 }).notNull(),
  discountAmount: decimal('discount_amount', { precision: 15, scale: 2 }).default('0.00').notNull(),
  taxAmount: decimal('tax_amount', { precision: 15, scale: 2 }).default('0.00').notNull(),
  grandTotal: decimal('grand_total', { precision: 15, scale: 2 }).notNull(),
  status: varchar('status', { length: 30 }).default('draft').notNull(),
  rejectionReason: text('rejection_reason'),
  convertedInvoiceId: uuid('converted_invoice_id').references(() => invoices.id, { onDelete: 'set null' }),
  notes: text('notes'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

export type Quotation = typeof quotations.$inferSelect
export type NewQuotation = typeof quotations.$inferInsert
