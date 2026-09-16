import { pgTable, uuid, varchar, text, decimal } from 'drizzle-orm/pg-core'
import { invoices } from './invoices'
import { catalogItems } from './catalog-items'

export const invoiceItems = pgTable('invoice_items', {
  id: uuid('id').defaultRandom().primaryKey(),
  invoiceId: uuid('invoice_id').references(() => invoices.id, { onDelete: 'cascade' }).notNull(),
  catalogItemId: uuid('catalog_item_id').references(() => catalogItems.id, { onDelete: 'set null' }),
  itemName: varchar('item_name', { length: 255 }).notNull(),
  description: text('description'),
  quantity: decimal('quantity', { precision: 10, scale: 2 }).notNull(),
  unitPrice: decimal('unit_price', { precision: 15, scale: 2 }).notNull(),
  amount: decimal('amount', { precision: 15, scale: 2 }).notNull(),
})

export type InvoiceItem = typeof invoiceItems.$inferSelect
export type NewInvoiceItem = typeof invoiceItems.$inferInsert
