import { pgTable, uuid, varchar, text, timestamp, boolean } from 'drizzle-orm/pg-core'

export const users = pgTable('users', {
  // 1. Identitas & Profil
  id: uuid('id').defaultRandom().primaryKey(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  fullName: varchar('full_name', { length: 255 }),
  phoneNumber: varchar('phone_number', { length: 20 }).unique(),
  avatarUrl: text('avatar_url'),

  // 2. Keamanan & Auth
  passwordHash: text('password_hash').notNull(),
  emailVerifiedAt: timestamp('email_verified_at'),
  phoneVerifiedAt: timestamp('phone_verified_at'),
  twoFactorSecret: text('two_factor_secret'),
  is2faEnabled: boolean('is_2fa_enabled').default(false).notNull(),

  // 3. Pekerjaan & Jabatan
  employeeId: varchar('employee_id', { length: 50 }),
  jobTitle: varchar('job_title', { length: 100 }),
  department: varchar('department', { length: 100 }),
  managerId: uuid('manager_id'),
  dateOfBirth: timestamp('date_of_birth'),
  ktpNumber: varchar('ktp_number', { length: 30 }),
  address: text('address'),

  // 4. Akses, Status, & Multi-Tenant
  role: varchar('role', { length: 50 }).default('user').notNull(),
  platformRole: varchar('platform_role', { length: 50 }),
  status: varchar('status', { length: 20 }).default('active').notNull(),
  currentTenantId: uuid('current_tenant_id'),
  lastLoginAt: timestamp('last_login_at'),

  // 5. Audit & Tracking
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  deletedAt: timestamp('deleted_at'),
})

export type User = typeof users.$inferSelect
export type NewUser = typeof users.$inferInsert
