import { pgTable, uuid, varchar, text, date, timestamp } from 'drizzle-orm/pg-core'
import { tenants } from './tenants'
import { clients } from './clients'
import { catalogItems } from './catalog-items'
import { projects } from './projects'
import { invoices } from './invoices'

export const warrantiesInsurances = pgTable('warranties_insurances', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }).notNull(),
  policyNumber: varchar('policy_number', { length: 100 }).notNull().unique(),
  type: varchar('type', { length: 20 }).default('warranty').notNull(),
  clientId: uuid('client_id').references(() => clients.id, { onDelete: 'restrict' }).notNull(),
  catalogItemId: uuid('catalog_item_id').references(() => catalogItems.id, { onDelete: 'set null' }),
  projectId: uuid('project_id').references(() => projects.id, { onDelete: 'set null' }),
  invoiceId: uuid('invoice_id').references(() => invoices.id, { onDelete: 'set null' }),
  serialNumberOrAssetId: varchar('serial_number_or_asset_id', { length: 255 }),
  providerName: varchar('provider_name', { length: 255 }).default('Internal Tenant').notNull(),
  coverageDetails: text('coverage_details'),
  startDate: date('start_date').notNull(),
  endDate: date('end_date').notNull(),
  status: varchar('status', { length: 20 }).default('active').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

export type WarrantyInsurance = typeof warrantiesInsurances.$inferSelect
export type NewWarrantyInsurance = typeof warrantiesInsurances.$inferInsert
