import { pgTable, uuid, date, boolean, timestamp } from 'drizzle-orm/pg-core'
import { tenants } from './tenants'
import { shifts } from './shifts'
import { users } from './users'

export const schedules = pgTable('schedules', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }).notNull(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  shiftId: uuid('shift_id').references(() => shifts.id, { onDelete: 'set null' }),
  scheduleDate: date('schedule_date').notNull(),
  isDayOff: boolean('is_day_off').default(false).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

export type Schedule = typeof schedules.$inferSelect
export type NewSchedule = typeof schedules.$inferInsert
