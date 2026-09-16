import { pgTable, uuid, varchar, text, timestamp } from 'drizzle-orm/pg-core'
import { tenants } from './tenants'
import { users } from './users'

export const clients = pgTable('clients', {
  // 1. Identitas Client / Perusahaan Client
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }).notNull(),
  name: varchar('name', { length: 255 }).notNull(),
  type: varchar('type', { length: 20 }).default('corporate').notNull(),
  industry: varchar('industry', { length: 100 }),
  website: varchar('website', { length: 255 }),
  logoUrl: text('logo_url'),

  // 2. Kontak Utama (Contact Person / PIC)
  picName: varchar('pic_name', { length: 255 }),
  picEmail: varchar('pic_email', { length: 255 }),
  picPhone: varchar('pic_phone', { length: 20 }),
  picPosition: varchar('pic_position', { length: 100 }),

  // 3. Status Pipeline & Prospek (CRM Specific)
  status: varchar('status', { length: 50 }).default('lead').notNull(),
  source: varchar('source', { length: 100 }),
  assignedTo: uuid('assigned_to').references(() => users.id, { onDelete: 'set null' }),

  // 4. Legalitas & Finansial
  taxId: varchar('tax_id', { length: 50 }),
  address: text('address'),
  billingEmail: varchar('billing_email', { length: 255 }),

  // 5. Audit & Tracking
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  deletedAt: timestamp('deleted_at'),
})

export type Client = typeof clients.$inferSelect
export type NewClient = typeof clients.$inferInsert
