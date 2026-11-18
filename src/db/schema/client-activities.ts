import { pgTable, uuid, varchar, text, timestamp } from 'drizzle-orm/pg-core'
import { tenants } from './tenants'
import { clients } from './clients'
import { users } from './users'

export const clientActivities = pgTable('client_activities', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }).notNull(),
  clientId: uuid('client_id').references(() => clients.id, { onDelete: 'cascade' }).notNull(),
  type: varchar('type', { length: 20 }).default('note').notNull(),
  content: text('content').notNull(),
  authorId: uuid('author_id').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  // Soft delete: catatan terhapus tetap tersimpan sebagai tombstone yang
  // hanya terlihat oleh admin (hub-admin / owner / admin tenant).
  deletedAt: timestamp('deleted_at'),
  deletedBy: uuid('deleted_by').references(() => users.id, { onDelete: 'set null' }),
})

export type ClientActivity = typeof clientActivities.$inferSelect
export type NewClientActivity = typeof clientActivities.$inferInsert
