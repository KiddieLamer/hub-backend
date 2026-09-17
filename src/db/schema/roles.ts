import { pgTable, uuid, varchar, timestamp } from 'drizzle-orm/pg-core'
import { users } from './users'

export const roles = pgTable('roles', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  name: varchar('name', { length: 100 }).notNull(),
  description: varchar('description', { length: 500 }),
  isSystem: varchar('is_system', { length: 10 }).default('false').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

export const permissions = pgTable('permissions', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: varchar('name', { length: 100 }).notNull().unique(),
  description: varchar('description', { length: 500 }),
})

export const rolePermissions = pgTable('role_permissions', {
  roleId: uuid('role_id').references(() => roles.id, { onDelete: 'cascade' }).notNull(),
  permissionId: uuid('permission_id').references(() => permissions.id, { onDelete: 'cascade' }).notNull(),
})

export const userRoles = pgTable('user_roles', {
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  roleId: uuid('role_id').references(() => roles.id, { onDelete: 'cascade' }).notNull(),
})

export type Role = typeof roles.$inferSelect
export type Permission = typeof permissions.$inferSelect
