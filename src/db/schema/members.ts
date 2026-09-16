import { pgTable, uuid, varchar, timestamp, pgEnum } from 'drizzle-orm/pg-core'
import { users } from './users'
import { tenants } from './tenants'

export const memberRoleEnum = pgEnum('member_role', ['owner', 'admin', 'member'])

export const tenantMembers = pgTable('tenant_members', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }).notNull(),
  role: memberRoleEnum('role').default('member').notNull(),
  jobTitle: varchar('job_title', { length: 255 }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

export type TenantMember = typeof tenantMembers.$inferSelect
