import { pgTable, uuid, varchar, text, date, decimal, timestamp } from 'drizzle-orm/pg-core'
import { tenants } from './tenants'
import { users } from './users'
import { expenseCategories } from './expense-categories'
import { clients } from './clients'
import { payrolls } from './payrolls'

export const expenseClaims = pgTable('expense_claims', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }).notNull(),
  expenseNumber: varchar('expense_number', { length: 100 }).notNull().unique(),
  categoryId: uuid('category_id').references(() => expenseCategories.id, { onDelete: 'restrict' }).notNull(),
  submittedBy: uuid('submitted_by').references(() => users.id, { onDelete: 'restrict' }).notNull(),
  clientId: uuid('client_id').references(() => clients.id, { onDelete: 'set null' }),
  payrollId: uuid('payroll_id').references(() => payrolls.id, { onDelete: 'set null' }),
  department: varchar('department', { length: 100 }),
  title: varchar('title', { length: 255 }).notNull(),
  amount: decimal('amount', { precision: 15, scale: 2 }).notNull(),
  expenseDate: date('expense_date').notNull(),
  paymentMethod: varchar('payment_method', { length: 50 }).default('reimbursement').notNull(),
  merchantName: varchar('merchant_name', { length: 255 }),
  receiptUrl: text('receipt_url'),
  notes: text('notes'),

  // Status & Approval
  status: varchar('status', { length: 50 }).default('draft').notNull(),
  approvedBy: uuid('approved_by').references(() => users.id, { onDelete: 'set null' }),
  approvalDate: timestamp('approval_date'),
  paidBy: uuid('paid_by').references(() => users.id, { onDelete: 'set null' }),
  paymentDate: timestamp('payment_date'),
  rejectionReason: text('rejection_reason'),

  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  deletedAt: timestamp('deleted_at'),
})

export type ExpenseClaim = typeof expenseClaims.$inferSelect
export type NewExpenseClaim = typeof expenseClaims.$inferInsert
