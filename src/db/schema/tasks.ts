import { pgTable, uuid, varchar, text, integer, decimal, timestamp, jsonb } from 'drizzle-orm/pg-core'
import { projects } from './projects'
import { kanbanColumns } from './kanban-columns'
import { projectMilestones } from './project-milestones'
import { users } from './users'

export const tasks = pgTable('tasks', {
  id: uuid('id').defaultRandom().primaryKey(),
  projectId: uuid('project_id').references(() => projects.id, { onDelete: 'cascade' }).notNull(),
  columnId: uuid('column_id').references(() => kanbanColumns.id, { onDelete: 'restrict' }).notNull(),
  milestoneId: uuid('milestone_id').references(() => projectMilestones.id, { onDelete: 'set null' }),
  parentTaskId: uuid('parent_task_id'),
  title: varchar('title', { length: 255 }).notNull(),
  description: text('description'),
  assignedTo: uuid('assigned_to').references(() => users.id, { onDelete: 'set null' }),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'restrict' }).notNull(),
  priority: varchar('priority', { length: 20 }).default('medium').notNull(),
  // Kategori task (general / social_media / ...) — daftar pilihan dijaga UI
  taskType: varchar('task_type', { length: 40 }).default('general').notNull(),
  // Taksonomi konten sosmed: cara monetisasi (A/B) & format isi (C) — nullable,
  // diisi saat task bertipe social_media
  contentType: varchar('content_type', { length: 40 }),
  contentFormat: varchar('content_format', { length: 40 }),
  // Channel tujuan posting (social_media task): daftar platform + link konten
  // per channel (wajib lengkap sebelum task boleh masuk kolom Done)
  channels: jsonb('channels').$type<string[]>().default([]).notNull(),
  channelLinks: jsonb('channel_links').$type<Record<string, string>>().default({}).notNull(),
  dueDate: timestamp('due_date'),
  estimatedHours: decimal('estimated_hours', { precision: 5, scale: 2 }),
  actualHours: decimal('actual_hours', { precision: 5, scale: 2 }).default('0.00').notNull(),
  position: integer('position').default(0).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  deletedAt: timestamp('deleted_at'),
})

export type Task = typeof tasks.$inferSelect
export type NewTask = typeof tasks.$inferInsert
