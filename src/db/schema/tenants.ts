import { pgTable, uuid, varchar, text, timestamp, integer } from 'drizzle-orm/pg-core'

export const tenants = pgTable('tenants', {
  // 1. Identitas & Profil Perusahaan
  id: uuid('id').defaultRandom().primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),
  slug: varchar('slug', { length: 100 }).notNull().unique(),
  website: varchar('website', { length: 255 }),
  customDomain: varchar('custom_domain', { length: 255 }).unique(),
  logoUrl: text('logo_url'),
  phoneNumber: varchar('phone_number', { length: 20 }),
  email: varchar('email', { length: 255 }),

  // 2. Isolasi Database (Multi-Tenant)
  dbSchema: varchar('db_schema', { length: 100 }).notNull().unique(),

  // 3. Legalitas & Kepatuhan
  taxId: varchar('tax_id', { length: 50 }),
  address: text('address'),
  gmapLink: text('gmap_link'),
  gdriveLink: text('gdrive_link'),

  // 4. Paket & Status Subskripsi
  plan: varchar('plan', { length: 50 }).default('free').notNull(),
  status: varchar('status', { length: 20 }).default('active').notNull(),
  maxUsers: integer('max_users').default(5).notNull(),
  trialEndsAt: timestamp('trial_ends_at'),

  // 5. Audit & Tracking
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  deletedAt: timestamp('deleted_at'),
})

export type Tenant = typeof tenants.$inferSelect
export type NewTenant = typeof tenants.$inferInsert
