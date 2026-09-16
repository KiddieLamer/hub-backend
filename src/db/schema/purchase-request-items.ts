import { pgTable, uuid, varchar, integer, text, decimal } from 'drizzle-orm/pg-core'
import { purchaseRequests } from './purchase-requests'

export const purchaseRequestItems = pgTable('purchase_request_items', {
  id: uuid('id').defaultRandom().primaryKey(),
  prId: uuid('pr_id').references(() => purchaseRequests.id, { onDelete: 'cascade' }).notNull(),
  itemName: varchar('item_name', { length: 255 }).notNull(),
  category: varchar('category', { length: 100 }),
  quantity: integer('quantity').notNull(),
  unitOfMeasure: varchar('unit_of_measure', { length: 50 }).default('pcs').notNull(),
  estimatedUnitPrice: decimal('estimated_unit_price', { precision: 15, scale: 2 }),
  notesSpecification: text('notes_specification'),
})

export type PurchaseRequestItem = typeof purchaseRequestItems.$inferSelect
export type NewPurchaseRequestItem = typeof purchaseRequestItems.$inferInsert
