import { pgTable, uuid, varchar, text, date, timestamp } from 'drizzle-orm/pg-core'
import { projects } from './projects'

export const projectMilestones = pgTable('project_milestones', {
  id: uuid('id').defaultRandom().primaryKey(),
  projectId: uuid('project_id').references(() => projects.id, { onDelete: 'cascade' }).notNull(),
  title: varchar('title', { length: 255 }).notNull(),
  description: text('description'),
  dueDate: date('due_date'),
  status: varchar('status', { length: 50 }).default('open').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

export type ProjectMilestone = typeof projectMilestones.$inferSelect
export type NewProjectMilestone = typeof projectMilestones.$inferInsert
