import { pgTable, uuid, varchar, text, date, decimal, timestamp } from 'drizzle-orm/pg-core'
import { tenants } from './tenants'
import { warrantiesInsurances } from './warranties-insurances'
import { supportTickets } from './support-tickets'
import { users } from './users'

export const warrantyClaims = pgTable('warranty_claims', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }).notNull(),
  claimNumber: varchar('claim_number', { length: 100 }).notNull().unique(),
  warrantyId: uuid('warranty_id').references(() => warrantiesInsurances.id, { onDelete: 'restrict' }).notNull(),
  ticketId: uuid('ticket_id').references(() => supportTickets.id, { onDelete: 'set null' }),
  assignedTo: uuid('assigned_to').references(() => users.id, { onDelete: 'set null' }),
  claimDate: date('claim_date').notNull(),
  issueDescription: text('issue_description').notNull(),
  claimAmount: decimal('claim_amount', { precision: 15, scale: 2 }).default('0.00').notNull(),
  status: varchar('status', { length: 20 }).default('pending').notNull(),
  resolutionNotes: text('resolution_notes'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

export type WarrantyClaim = typeof warrantyClaims.$inferSelect
export type NewWarrantyClaim = typeof warrantyClaims.$inferInsert
