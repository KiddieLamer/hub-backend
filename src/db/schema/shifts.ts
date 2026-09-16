import { pgTable, uuid, varchar, time, integer, timestamp } from 'drizzle-orm/pg-core'
import { tenants } from './tenants'

export const shifts = pgTable('shifts', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }).notNull(),
  name: varchar('name', { length: 100 }).notNull(),
  clockInTime: time('clock_in_time').notNull(),
  clockOutTime: time('clock_out_time').notNull(),
  lateGracePeriodMins: integer('late_grace_period_mins').default(15).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

export type Shift = typeof shifts.$inferSelect
export type NewShift = typeof shifts.$inferInsert
