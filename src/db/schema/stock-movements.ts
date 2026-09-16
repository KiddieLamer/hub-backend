import { pgTable, uuid, varchar, integer, text, timestamp } from 'drizzle-orm/pg-core'
import { catalogItems } from './catalog-items'
import { pos } from './pos'
import { projects } from './projects'
import { users } from './users'

export const stockMovements = pgTable('stock_movements', {
  id: uuid('id').defaultRandom().primaryKey(),
  catalogItemId: uuid('catalog_item_id').references(() => catalogItems.id, { onDelete: 'restrict' }).notNull(),
  movementType: varchar('movement_type', { length: 50 }).notNull(),
  quantity: integer('quantity').notNull(),
  stockBefore: integer('stock_before').notNull(),
  stockAfter: integer('stock_after').notNull(),
  referencePoId: uuid('reference_po_id').references(() => pos.id, { onDelete: 'set null' }),
  referenceProjectId: uuid('reference_project_id').references(() => projects.id, { onDelete: 'set null' }),
  performedBy: uuid('performed_by').references(() => users.id, { onDelete: 'restrict' }).notNull(),
  notes: text('notes'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

export type StockMovement = typeof stockMovements.$inferSelect
export type NewStockMovement = typeof stockMovements.$inferInsert
