import { pgTable, uuid, varchar, text, date, decimal, timestamp } from 'drizzle-orm/pg-core'
import { assets } from './assets'

export const assetMaintenances = pgTable('asset_maintenances', {
  id: uuid('id').defaultRandom().primaryKey(),
  assetId: uuid('asset_id').references(() => assets.id, { onDelete: 'cascade' }).notNull(),
  maintenanceDate: date('maintenance_date').notNull(),
  cost: decimal('cost', { precision: 15, scale: 2 }).default('0.00').notNull(),
  vendorName: varchar('vendor_name', { length: 255 }),
  description: text('description').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

export type AssetMaintenance = typeof assetMaintenances.$inferSelect
export type NewAssetMaintenance = typeof assetMaintenances.$inferInsert
