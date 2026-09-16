import { pgTable, uuid, varchar, text, timestamp } from 'drizzle-orm/pg-core'
import { tenants } from './tenants'
import { purchaseOrders } from './purchase-orders'
import { users } from './users'

export const goodsReceipts = pgTable('goods_receipts', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }).notNull(),
  grNumber: varchar('gr_number', { length: 100 }).notNull().unique(),
  poId: uuid('po_id').references(() => purchaseOrders.id, { onDelete: 'restrict' }).notNull(),
  receivedBy: uuid('received_by').references(() => users.id, { onDelete: 'restrict' }).notNull(),
  receivedDate: timestamp('received_date').defaultNow().notNull(),
  deliveryNoteNumber: varchar('delivery_note_number', { length: 100 }),
  status: varchar('status', { length: 50 }).default('completed').notNull(),
  deliveryPhotoUrl: text('delivery_photo_url'),
  notes: text('notes'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

export type GoodsReceipt = typeof goodsReceipts.$inferSelect
export type NewGoodsReceipt = typeof goodsReceipts.$inferInsert
