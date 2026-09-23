import { pgTable, uuid, varchar, timestamp, integer, unique } from 'drizzle-orm/pg-core'
import { tenants } from './tenants'
import { roles } from './roles'

export const positions = pgTable('positions', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }).notNull(),
  name: varchar('name', { length: 100 }).notNull(),
  // Higher level = higher rank (e.g. 0 = staff, 50 = manager, 100 = director)
  level: integer('level').default(0).notNull(),
  parentId: uuid('parent_id').references((): any => positions.id, { onDelete: 'set null' }),
  // RBAC role automatically granted to members holding this position
  defaultRoleId: uuid('default_role_id').references(() => roles.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  unique('positions_tenant_name_uniq').on(t.tenantId, t.name),
])

export type Position = typeof positions.$inferSelect
export type NewPosition = typeof positions.$inferInsert
