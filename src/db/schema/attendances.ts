import { pgTable, uuid, varchar, date, timestamp, integer } from 'drizzle-orm/pg-core'
import { users } from './users'
import { tenants } from './tenants'

export const attendances = pgTable('attendances', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }).notNull(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  attendanceDate: date('attendance_date').notNull(),
  checkInTime: timestamp('check_in_time'),
  checkInLatLong: varchar('check_in_lat_long', { length: 100 }),
  checkInPhotoUrl: varchar('check_in_photo_url'),
  checkOutTime: timestamp('check_out_time'),
  checkOutLatLong: varchar('check_out_lat_long', { length: 100 }),
  checkOutPhotoUrl: varchar('check_out_photo_url'),
  status: varchar('status', { length: 20 }).default('present').notNull(),
  lateMinutes: integer('late_minutes').default(0).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

export type Attendance = typeof attendances.$inferSelect
export type NewAttendance = typeof attendances.$inferInsert
