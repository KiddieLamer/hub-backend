import { pgTable, uuid, varchar, text, integer, jsonb, timestamp } from 'drizzle-orm/pg-core'
import { tenants } from './tenants'
import { users } from './users'

export interface SocialHandles {
  instagram?: string
  linkedin?: string
  twitter?: string
}

export const clients = pgTable('clients', {
  // 1. Identitas Client / Perusahaan Client
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }).notNull(),
  name: varchar('name', { length: 255 }).notNull(),
  type: varchar('type', { length: 20 }).default('corporate').notNull(),
  industry: varchar('industry', { length: 100 }),
  website: varchar('website', { length: 255 }),
  logoUrl: text('logo_url'),
  avatarUrl: text('avatar_url'),
  companyName: varchar('company_name', { length: 255 }),
  jobTitle: varchar('job_title', { length: 100 }),

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

  // 5. Profil CRM (detail customer di dashboard CRM)
  mobile: varchar('mobile', { length: 20 }),
  topic: varchar('topic', { length: 255 }),
  rating: varchar('rating', { length: 20 }),
  budget: varchar('budget', { length: 50 }),
  identityType: varchar('identity_type', { length: 20 }),
  identityNumber: varchar('identity_number', { length: 50 }),
  tags: text('tags').array(),
  socialMedia: jsonb('social_media').$type<SocialHandles>(),

  // 6. Skoring & Klasifikasi (dipakai LeadScoreCard / LeadSidebar)
  score: integer('score').default(0).notNull(),
  grade: varchar('grade', { length: 20 }).default('Grade C').notNull(),
  statusTag: varchar('status_tag', { length: 50 }).default('New').notNull(),

  // 7. Audit & Tracking
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  deletedAt: timestamp('deleted_at'),
})

export type Client = typeof clients.$inferSelect
export type NewClient = typeof clients.$inferInsert
