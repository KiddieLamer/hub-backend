import { pgTable, uuid, varchar } from 'drizzle-orm/pg-core'
import { projects } from './projects'

export const taskTags = pgTable('task_tags', {
  id: uuid('id').defaultRandom().primaryKey(),
  projectId: uuid('project_id').references(() => projects.id, { onDelete: 'cascade' }).notNull(),
  name: varchar('name', { length: 50 }).notNull(),
  colorCode: varchar('color_code', { length: 20 }).default('#EF4444').notNull(),
})

export type TaskTag = typeof taskTags.$inferSelect
export type NewTaskTag = typeof taskTags.$inferInsert
