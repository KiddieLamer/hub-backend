import { pgTable, uuid, varchar, timestamp } from 'drizzle-orm/pg-core'
import { projects } from './projects'
import { users } from './users'

export const projectMembers = pgTable('project_members', {
  id: uuid('id').defaultRandom().primaryKey(),
  projectId: uuid('project_id').references(() => projects.id, { onDelete: 'cascade' }).notNull(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  roleInProject: varchar('role_in_project', { length: 50 }).default('member').notNull(),
  assignedAt: timestamp('assigned_at').defaultNow().notNull(),
})

export type ProjectMember = typeof projectMembers.$inferSelect
export type NewProjectMember = typeof projectMembers.$inferInsert
