import { pgTable, uuid, varchar, integer, timestamp, index } from 'drizzle-orm/pg-core'

/**
 * Persistent login lockout store.
 *
 * Keyed by lowercased email. Survives process restarts and is shared across
 * PM2 cluster workers (unlike the old in-memory Map). One row per email.
 */
export const loginAttempts = pgTable(
  'login_attempts',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    email: varchar('email', { length: 255 }).notNull().unique(),
    count: integer('count').default(0).notNull(),
    lockedUntil: timestamp('locked_until'),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    emailIdx: index('login_attempts_email_idx').on(table.email),
  }),
)

export type LoginAttempt = typeof loginAttempts.$inferSelect
export type NewLoginAttempt = typeof loginAttempts.$inferInsert
