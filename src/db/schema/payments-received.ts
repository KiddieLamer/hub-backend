import { pgTable, uuid, varchar, text, decimal, timestamp } from 'drizzle-orm/pg-core'
import { invoices } from './invoices'
import { users } from './users'

export const paymentsReceived = pgTable('payments_received', {
  id: uuid('id').defaultRandom().primaryKey(),
  paymentNumber: varchar('payment_number', { length: 100 }).notNull().unique(),
  invoiceId: uuid('invoice_id').references(() => invoices.id, { onDelete: 'restrict' }).notNull(),
  receivedBy: uuid('received_by').references(() => users.id, { onDelete: 'restrict' }).notNull(),
  amount: decimal('amount', { precision: 15, scale: 2 }).notNull(),
  paymentDate: timestamp('payment_date').defaultNow().notNull(),
  paymentMethod: varchar('payment_method', { length: 50 }).default('bank_transfer').notNull(),
  referenceNumber: varchar('reference_number', { length: 100 }),
  proofUrl: text('proof_url'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

export type PaymentReceived = typeof paymentsReceived.$inferSelect
export type NewPaymentReceived = typeof paymentsReceived.$inferInsert
