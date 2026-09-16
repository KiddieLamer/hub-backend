import { pgTable, uuid, varchar, text, timestamp } from 'drizzle-orm/pg-core'
import { tenants } from './tenants'
import { users } from './users'

export const systemAuditLogs = pgTable('system_audit_logs', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }).notNull(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  action: varchar('action', { length: 50 }).notNull(),
  module: varchar('module', { length: 50 }).notNull(),
  recordId: uuid('record_id'),
  ipAddress: varchar('ip_address', { length: 45 }),
  userAgent: text('user_agent'),
  oldValues: text('old_values'),
  newValues: text('new_values'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

export type SystemAuditLog = typeof systemAuditLogs.$inferSelect
export type NewSystemAuditLog = typeof systemAuditLogs.$inferInsert
