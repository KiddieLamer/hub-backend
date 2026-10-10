import { pgTable, uuid, varchar, integer, text, timestamp } from 'drizzle-orm/pg-core'
import { tenants } from './tenants'
import { clients } from './clients'

export const clientInsights = pgTable('client_insights', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }).notNull(),
  clientId: uuid('client_id').references(() => clients.id, { onDelete: 'cascade' }).notNull(),
  text: varchar('text', { length: 500 }).notNull(),
  subtext: text('subtext'),
  sortOrder: integer('sort_order').default(0).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

export type ClientInsight = typeof clientInsights.$inferSelect
export type NewClientInsight = typeof clientInsights.$inferInsert
