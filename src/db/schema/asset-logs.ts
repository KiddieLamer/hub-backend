import { pgTable, uuid, varchar, text, timestamp } from 'drizzle-orm/pg-core'
import { assets } from './assets'
import { users } from './users'

export const assetLogs = pgTable('asset_logs', {
  id: uuid('id').defaultRandom().primaryKey(),
  assetId: uuid('asset_id').references(() => assets.id, { onDelete: 'cascade' }).notNull(),
  previousUserId: uuid('previous_user_id').references(() => users.id, { onDelete: 'set null' }),
  newUserId: uuid('new_user_id').references(() => users.id, { onDelete: 'set null' }),
  action: varchar('action', { length: 50 }).notNull(),
  notes: text('notes'),
  actionDate: timestamp('action_date').defaultNow().notNull(),
})

export type AssetLog = typeof assetLogs.$inferSelect
export type NewAssetLog = typeof assetLogs.$inferInsert
