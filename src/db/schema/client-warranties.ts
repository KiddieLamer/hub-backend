import { pgTable, uuid, varchar, date, timestamp } from 'drizzle-orm/pg-core'
import { tenants } from './tenants'
import { clients } from './clients'

export const clientWarranties = pgTable('client_warranties', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }).notNull(),
  clientId: uuid('client_id').references(() => clients.id, { onDelete: 'cascade' }).notNull().unique(),
  productName: varchar('product_name', { length: 255 }).notNull(),
  serialNumber: varchar('serial_number', { length: 100 }),
  startDate: date('start_date'),
  endDate: date('end_date'),
  coverageType: varchar('coverage_type', { length: 255 }),
  status: varchar('status', { length: 20 }).default('Active').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

export type ClientWarranty = typeof clientWarranties.$inferSelect
export type NewClientWarranty = typeof clientWarranties.$inferInsert
