import { pgTable, uuid, varchar, text, decimal, timestamp } from 'drizzle-orm/pg-core'
import { quotations } from './quotations'
import { catalogItems } from './catalog-items'

export const quotationItems = pgTable('quotation_items', {
  id: uuid('id').defaultRandom().primaryKey(),
  quotationId: uuid('quotation_id').references(() => quotations.id, { onDelete: 'cascade' }).notNull(),
  catalogItemId: uuid('catalog_item_id').references(() => catalogItems.id, { onDelete: 'set null' }),
  itemName: varchar('item_name', { length: 255 }).notNull(),
  description: text('description'),
  quantity: decimal('quantity', { precision: 10, scale: 2 }).notNull(),
  unit: varchar('unit', { length: 50 }).default('pcs').notNull(),
  unitPrice: decimal('unit_price', { precision: 15, scale: 2 }).notNull(),
  unitCostPrice: decimal('unit_cost_price', { precision: 15, scale: 2 }).default('0.00').notNull(),
  totalPrice: decimal('total_price', { precision: 15, scale: 2 }).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

export type QuotationItem = typeof quotationItems.$inferSelect
export type NewQuotationItem = typeof quotationItems.$inferInsert
