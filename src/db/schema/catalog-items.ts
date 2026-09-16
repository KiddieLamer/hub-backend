import { pgTable, uuid, varchar, text, boolean, decimal, integer, timestamp } from 'drizzle-orm/pg-core'
import { tenants } from './tenants'
import { catalogCategories } from './catalog-categories'

export const catalogItems = pgTable('catalog_items', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }).notNull(),
  itemCode: varchar('item_code', { length: 100 }).notNull().unique(),
  name: varchar('name', { length: 255 }).notNull(),
  type: varchar('type', { length: 50 }).notNull(),
  categoryId: uuid('category_id').references(() => catalogCategories.id, { onDelete: 'set null' }),
  description: text('description'),
  price: decimal('price', { precision: 15, scale: 2 }).notNull(),
  costPrice: decimal('cost_price', { precision: 15, scale: 2 }).default('0.00').notNull(),
  unit: varchar('unit', { length: 50 }).default('pcs').notNull(),
  isTrackInventory: boolean('is_track_inventory').default(false).notNull(),
  stockQuantity: integer('stock_quantity').default(0).notNull(),
  status: varchar('status', { length: 20 }).default('active').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

export type CatalogItem = typeof catalogItems.$inferSelect
export type NewCatalogItem = typeof catalogItems.$inferInsert
