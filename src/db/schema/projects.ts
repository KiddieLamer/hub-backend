import { pgTable, uuid, varchar, text, date, decimal, timestamp } from 'drizzle-orm/pg-core'
import { tenants } from './tenants'
import { clients } from './clients'
import { users } from './users'

export const projects = pgTable('projects', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }).notNull(),
  projectCode: varchar('project_code', { length: 100 }).notNull().unique(),
  name: varchar('name', { length: 255 }).notNull(),
  clientId: uuid('client_id').references(() => clients.id, { onDelete: 'set null' }),
  projectManagerId: uuid('project_manager_id').references(() => users.id, { onDelete: 'restrict' }).notNull(),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'restrict' }).notNull(),
  startDate: date('start_date'),
  endDate: date('end_date'),
  status: varchar('status', { length: 50 }).default('planning').notNull(),
  budget: decimal('budget', { precision: 15, scale: 2 }).default('0.00').notNull(),
  description: text('description'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  deletedAt: timestamp('deleted_at'),
})

export type Project = typeof projects.$inferSelect
export type NewProject = typeof projects.$inferInsert
