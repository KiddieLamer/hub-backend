import { pgTable, uuid, timestamp } from 'drizzle-orm/pg-core'
import { tasks } from './tasks'
import { users } from './users'

export const taskAssignees = pgTable('task_assignees', {
  id: uuid('id').defaultRandom().primaryKey(),
  taskId: uuid('task_id').references(() => tasks.id, { onDelete: 'cascade' }).notNull(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  assignedAt: timestamp('assigned_at').defaultNow().notNull(),
})

export type TaskAssignee = typeof taskAssignees.$inferSelect
export type NewTaskAssignee = typeof taskAssignees.$inferInsert
