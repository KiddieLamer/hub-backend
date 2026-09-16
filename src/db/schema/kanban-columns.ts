import { pgTable, uuid, varchar, integer } from 'drizzle-orm/pg-core'
import { projects } from './projects'

export const kanbanColumns = pgTable('kanban_columns', {
  id: uuid('id').defaultRandom().primaryKey(),
  projectId: uuid('project_id').references(() => projects.id, { onDelete: 'cascade' }).notNull(),
  name: varchar('name', { length: 100 }).notNull(),
  position: integer('position').notNull(),
  colorCode: varchar('color_code', { length: 20 }).default('#6B7280').notNull(),
})

export type KanbanColumn = typeof kanbanColumns.$inferSelect
export type NewKanbanColumn = typeof kanbanColumns.$inferInsert
