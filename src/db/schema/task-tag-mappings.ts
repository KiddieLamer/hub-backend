import { pgTable, uuid } from 'drizzle-orm/pg-core'
import { tasks } from './tasks'
import { taskTags } from './task-tags'

export const taskTagMappings = pgTable('task_tag_mappings', {
  taskId: uuid('task_id').references(() => tasks.id, { onDelete: 'cascade' }).notNull(),
  tagId: uuid('tag_id').references(() => taskTags.id, { onDelete: 'cascade' }).notNull(),
})

export type TaskTagMapping = typeof taskTagMappings.$inferSelect
export type NewTaskTagMapping = typeof taskTagMappings.$inferInsert
