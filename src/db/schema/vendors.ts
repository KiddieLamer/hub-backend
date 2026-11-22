import { pgTable, uuid, varchar, text, decimal, timestamp, jsonb } from 'drizzle-orm/pg-core'
import { tenants } from './tenants'

export const vendors = pgTable('vendors', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }).notNull(),
  companyName: varchar('company_name', { length: 255 }).notNull(),
  picName: varchar('pic_name', { length: 255 }),
  email: varchar('email', { length: 255 }),
  phoneNumber: varchar('phone_number', { length: 20 }),
  taxId: varchar('tax_id', { length: 50 }),
  address: text('address'),
  bankDetails: text('bank_details'),
  /** Daftar komoditas yang dijual + harga: [{ commodity, price }] */
  commodities: jsonb('commodities').$type<Array<{ commodity: string; price: number }>>().default([]),
  rating: decimal('rating', { precision: 3, scale: 2 }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  deletedAt: timestamp('deleted_at'),
})

export type Vendor = typeof vendors.$inferSelect
export type NewVendor = typeof vendors.$inferInsert
