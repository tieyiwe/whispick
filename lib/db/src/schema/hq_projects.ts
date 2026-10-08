import { pgTable, text, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// The HQ's own project management — internal collaboration for the owner
// and staff (gated by the "projects" permission, which every role preset
// includes by default). Deliberately simple: projects hold tasks, tasks
// hold a status/assignee/due date and a comment thread. Not user-facing in
// any way — this is the team running the business, not the product.
export const hqProjectsTable = pgTable("hq_projects", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  status: text("status").notNull().default("active"), // 'active' | 'archived'
  createdByAdminId: text("created_by_admin_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertHqProjectSchema = createInsertSchema(hqProjectsTable).omit({ createdAt: true });
export type InsertHqProject = z.infer<typeof insertHqProjectSchema>;
export type HqProject = typeof hqProjectsTable.$inferSelect;

export const hqTasksTable = pgTable("hq_tasks", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull(),
  title: text("title").notNull(),
  detail: text("detail"),
  status: text("status").notNull().default("todo"), // 'todo' | 'in_progress' | 'done'
  // users.id of a staff member (owner or linked grant) — assignment
  // notifies them in-app (routes/adminProjects.ts).
  assigneeAdminId: text("assignee_admin_id"),
  dueAt: timestamp("due_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdByAdminId: text("created_by_admin_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("hq_tasks_project_id_idx").on(table.projectId),
  index("hq_tasks_assignee_idx").on(table.assigneeAdminId),
]);

export const insertHqTaskSchema = createInsertSchema(hqTasksTable).omit({ createdAt: true });
export type InsertHqTask = z.infer<typeof insertHqTaskSchema>;
export type HqTask = typeof hqTasksTable.$inferSelect;

export const hqTaskCommentsTable = pgTable("hq_task_comments", {
  id: text("id").primaryKey(),
  taskId: text("task_id").notNull(),
  authorAdminId: text("author_admin_id").notNull(),
  body: text("body").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("hq_task_comments_task_id_idx").on(table.taskId),
]);

export const insertHqTaskCommentSchema = createInsertSchema(hqTaskCommentsTable).omit({ createdAt: true });
export type InsertHqTaskComment = z.infer<typeof insertHqTaskCommentSchema>;
export type HqTaskComment = typeof hqTaskCommentsTable.$inferSelect;
