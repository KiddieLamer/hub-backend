import { pgTable, uuid, integer, timestamp } from 'drizzle-orm/pg-core'
import { clientSubscriptions } from './client-subscriptions'
import { catalogItems } from './catalog-items'

export const clientQuotaBalances = pgTable('client_quota_balances', {
  id: uuid('id').defaultRandom().primaryKey(),
  clientSubscriptionId: uuid('client_subscription_id').references(() => clientSubscriptions.id, { onDelete: 'cascade' }).notNull(),
  serviceItemId: uuid('service_item_id').references(() => catalogItems.id, { onDelete: 'restrict' }).notNull(),
  totalQuota: integer('total_quota').notNull(),
  usedQuota: integer('used_quota').default(0).notNull(),
  remainingQuota: integer('remaining_quota').notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

export type ClientQuotaBalance = typeof clientQuotaBalances.$inferSelect
export type NewClientQuotaBalance = typeof clientQuotaBalances.$inferInsert
