import { pgTable, uuid, varchar, text, date, decimal, boolean, timestamp } from 'drizzle-orm/pg-core'
import { tenants } from './tenants'
import { clients } from './clients'
import { catalogItems } from './catalog-items'

export const clientSubscriptions = pgTable('client_subscriptions', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }).notNull(),
  subscriptionCode: varchar('subscription_code', { length: 100 }).notNull().unique(),
  clientId: uuid('client_id').references(() => clients.id, { onDelete: 'restrict' }).notNull(),
  catalogItemId: uuid('catalog_item_id').references(() => catalogItems.id, { onDelete: 'restrict' }).notNull(),
  startDate: date('start_date').notNull(),
  endDate: date('end_date').notNull(),
  billingCycle: varchar('billing_cycle', { length: 20 }).default('monthly').notNull(),
  pricePerCycle: decimal('price_per_cycle', { precision: 15, scale: 2 }).notNull(),
  status: varchar('status', { length: 20 }).default('active').notNull(),
  autoRenew: boolean('auto_renew').default(true).notNull(),
  notes: text('notes'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

export type ClientSubscription = typeof clientSubscriptions.$inferSelect
export type NewClientSubscription = typeof clientSubscriptions.$inferInsert
