import { pgTable, uuid, varchar, text, date, decimal, integer, timestamp } from 'drizzle-orm/pg-core'
import { tenants } from './tenants'
import { users } from './users'

export const assets = pgTable('assets', {
  // 1. Identitas & Spesifikasi Barang
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }).notNull(),
  assetCode: varchar('asset_code', { length: 100 }).notNull().unique(),
  serialNumber: varchar('serial_number', { length: 100 }).unique(),
  name: varchar('name', { length: 255 }).notNull(),
  category: varchar('category', { length: 100 }).notNull(),
  brandModel: varchar('brand_model', { length: 100 }),
  photoUrl: text('photo_url'),
  qrCodeUrl: text('qr_code_url'),

  // 2. Kepemilikan & Lokasi Physical
  assignedTo: uuid('assigned_to').references(() => users.id, { onDelete: 'set null' }),
  department: varchar('department', { length: 100 }),
  location: varchar('location', { length: 150 }).notNull(),
  assignedAt: timestamp('assigned_at'),

  // 3. Status & Kondisi Fisik
  status: varchar('status', { length: 50 }).default('available').notNull(),
  condition: varchar('condition', { length: 50 }).default('good').notNull(),

  // 4. Keuangan, Garansi, & Penyusutan
  purchaseDate: date('purchase_date'),
  purchaseCost: decimal('purchase_cost', { precision: 15, scale: 2 }),
  supplierVendor: varchar('supplier_vendor', { length: 255 }),
  warrantyExpiryDate: date('warranty_expiry_date'),
  depreciationUsefulLifeMonths: integer('depreciation_useful_life_months'),

  // 5. Audit & Tracking
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  deletedAt: timestamp('deleted_at'),
})

export type Asset = typeof assets.$inferSelect
export type NewAsset = typeof assets.$inferInsert
