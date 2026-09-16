import { pgTable, uuid, integer, decimal } from 'drizzle-orm/pg-core'
import { pos } from './pos'
import { catalogItems } from './catalog-items'

export const poItems = pgTable('po_items', {
  id: uuid('id').defaultRandom().primaryKey(),
  poId: uuid('po_id').references(() => pos.id, { onDelete: 'cascade' }).notNull(),
  catalogItemId: uuid('catalog_item_id').references(() => catalogItems.id, { onDelete: 'restrict' }).notNull(),
  quantityOrdered: integer('quantity_ordered').notNull(),
  quantityReceived: integer('quantity_received').default(0).notNull(),
  unitCost: decimal('unit_cost', { precision: 15, scale: 2 }).notNull(),
  totalCost: decimal('total_cost', { precision: 15, scale: 2 }).notNull(),
})

export type PoItem = typeof poItems.$inferSelect
export type NewPoItem = typeof poItems.$inferInsert
