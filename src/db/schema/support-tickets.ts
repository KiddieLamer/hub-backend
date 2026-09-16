import { pgTable, uuid, varchar, text, timestamp } from 'drizzle-orm/pg-core'
import { tenants } from './tenants'
import { clients } from './clients'
import { users } from './users'

export const supportTickets = pgTable('support_tickets', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }).notNull(),
  ticketNumber: varchar('ticket_number', { length: 100 }).notNull().unique(),
  clientId: uuid('client_id').references(() => clients.id, { onDelete: 'set null' }),
  reportedBy: uuid('reported_by').references(() => users.id, { onDelete: 'restrict' }).notNull(),
  assignedTo: uuid('assigned_to').references(() => users.id, { onDelete: 'set null' }),
  category: varchar('category', { length: 50 }).notNull(),
  priority: varchar('priority', { length: 20 }).default('medium').notNull(),
  subject: varchar('subject', { length: 255 }).notNull(),
  description: text('description').notNull(),
  status: varchar('status', { length: 50 }).default('open').notNull(),
  slaDueDate: timestamp('sla_due_date'),
  resolvedAt: timestamp('resolved_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

export type SupportTicket = typeof supportTickets.$inferSelect
export type NewSupportTicket = typeof supportTickets.$inferInsert
