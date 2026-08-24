import { Router, type IRouter } from "express";
import {
  db,
  hqProjectsTable,
  hqTasksTable,
  hqTaskCommentsTable,
  usersTable,
  type User,
} from "@workspace/db";
import { eq, and, count, desc, asc, inArray } from "drizzle-orm";
import { randomUUID } from "crypto";
import { z } from "zod";
import { requireAdmin, requirePermission } from "../lib/adminAuth";
import { notifyUserPersisted } from "../lib/push";
import { listStaff } from "../lib/staff";
import { logAdminAction } from "../lib/adminAudit";

const router: IRouter = Router();

// The HQ's internal project/task workspace. Same "/admin" base path,
// separate file (same pattern as adminDebateAgent.ts) — every route below
// reads as /api/admin/projects... and /api/admin/tasks.... Gated by the
// "projects" permission, which every staff role preset includes: the
// workspace is where the team coordinates, so staff belong in it by
// default.
//
// Scoped to this router's own two prefixes ("/projects", "/tasks") — same
// reasoning as adminDebateAgent.ts/adminCircleAgent.ts's own comments. This
// router is mounted at the bare "/admin" base (routes/index.ts), ahead of
// other "/admin"-base routers (e.g. adminTextWhisps.ts's distinct
// "/admin/text-whisps" prefix is mounted after it) — an unscoped
// router.use(requirePermission("projects")) here would run for every
// /admin/* request that falls through this far without a matching route
// yet, wrongly 403'ing a collaborator who holds "notifications" (or any
// other permission) but not "projects" out of unrelated areas mounted
// later in the chain, exactly the bug docs/api.md warns about.
router.use("/projects", requireAdmin);
router.use("/projects", requirePermission("projects"));
router.use("/tasks", requireAdmin);
router.use("/tasks", requirePermission("projects"));

// GET /api/admin/projects
router.get("/projects", async (_req, res): Promise<void> => {
  const [projects, taskCounts, staff] = await Promise.all([
    db.select().from(hqProjectsTable).orderBy(desc(hqProjectsTable.createdAt)),
    db
      .select({ projectId: hqTasksTable.projectId, status: hqTasksTable.status, count: count() })
      .from(hqTasksTable)
      .groupBy(hqTasksTable.projectId, hqTasksTable.status),
    listStaff(),
  ]);
  const countsByProject = new Map<string, { open: number; done: number }>();
  for (const row of taskCounts) {
    const entry = countsByProject.get(row.projectId) ?? { open: 0, done: 0 };
    if (row.status === "done") entry.done += row.count;
    else entry.open += row.count;
    countsByProject.set(row.projectId, entry);
  }
  res.json({
    items: projects.map((p) => ({ ...p, openTasks: countsByProject.get(p.id)?.open ?? 0, doneTasks: countsByProject.get(p.id)?.done ?? 0 })),
    staff,
  });
});

const projectInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2000).nullable().optional(),
});

// POST /api/admin/projects
router.post("/projects", async (req: any, res): Promise<void> => {
  const parsed = projectInputSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Project needs a name (max 120 chars)." });
    return;
  }
  const adminUser = req.adminUser as User;
  const id = randomUUID();
  await db.insert(hqProjectsTable).values({
    id,
    name: parsed.data.name,
    description: parsed.data.description ?? null,
    createdByAdminId: adminUser.id,
  });
  const created = await db.select().from(hqProjectsTable).where(eq(hqProjectsTable.id, id)).then((r) => r[0]);
  res.status(201).json({ ...created, openTasks: 0, doneTasks: 0 });
});

const projectUpdateSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  status: z.enum(["active", "archived"]).optional(),
});

// PATCH /api/admin/projects/:id
router.patch("/projects/:id", async (req, res): Promise<void> => {
  const project = await db.select().from(hqProjectsTable).where(eq(hqProjectsTable.id, req.params.id)).then((r) => r[0]);
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  const parsed = projectUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid project update" });
    return;
  }
  await db
    .update(hqProjectsTable)
    .set({
      ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
      ...(parsed.data.description !== undefined ? { description: parsed.data.description } : {}),
      ...(parsed.data.status !== undefined ? { status: parsed.data.status } : {}),
    })
    .where(eq(hqProjectsTable.id, project.id));
  // Only the status transition is logged — a rename/description edit is
  // routine workspace upkeep, but archiving is the one change worth being
  // able to answer "who closed this out, and when."
  if (parsed.data.status !== undefined && parsed.data.status !== project.status) {
    const adminUser = (req as any).adminUser as User;
    logAdminAction(adminUser.id, "hq_project.status_change", { type: "hq_project", id: project.id }, { name: project.name, from: project.status, to: parsed.data.status });
  }
  const updated = await db.select().from(hqProjectsTable).where(eq(hqProjectsTable.id, project.id)).then((r) => r[0]);
  res.json(updated);
});

// GET /api/admin/projects/:id — the working view: tasks with assignee
// display info and comment counts.
router.get("/projects/:id", async (req, res): Promise<void> => {
  const project = await db.select().from(hqProjectsTable).where(eq(hqProjectsTable.id, req.params.id)).then((r) => r[0]);
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  const tasks = await db
    .select()
    .from(hqTasksTable)
    .where(eq(hqTasksTable.projectId, project.id))
    .orderBy(asc(hqTasksTable.createdAt));
  const taskIds = tasks.map((t) => t.id);
  const [commentCounts, staff] = await Promise.all([
    taskIds.length
      ? db
          .select({ taskId: hqTaskCommentsTable.taskId, count: count() })
          .from(hqTaskCommentsTable)
          .where(inArray(hqTaskCommentsTable.taskId, taskIds))
          .groupBy(hqTaskCommentsTable.taskId)
      : Promise.resolve([] as { taskId: string; count: number }[]),
    listStaff(),
  ]);
  const commentsById = new Map(commentCounts.map((c) => [c.taskId, c.count]));
  const staffById = new Map(staff.map((s) => [s.id, s]));
  res.json({
    ...project,
    staff,
    tasks: tasks.map((t) => ({
      ...t,
      commentCount: commentsById.get(t.id) ?? 0,
      assigneeEmail: t.assigneeAdminId ? (staffById.get(t.assigneeAdminId)?.email ?? null) : null,
    })),
  });
});

const taskInputSchema = z.object({
  title: z.string().trim().min(1).max(200),
  detail: z.string().trim().max(4000).nullable().optional(),
  assigneeAdminId: z.string().max(64).nullable().optional(),
  dueAt: z.string().datetime({ offset: true }).nullable().optional(),
});

// An assignee must be actual staff. Without this check, any string id could
// be assigned — and notifyAssignment would then push a real admin's email
// into an arbitrary END USER's notification bell.
async function isStaffId(id: string): Promise<boolean> {
  const staff = await listStaff();
  return staff.some((s) => s.id === id);
}

async function notifyAssignment(assigneeAdminId: string, actor: User, taskTitle: string, projectName: string): Promise<void> {
  if (assigneeAdminId === actor.id) return; // no self-notify noise
  await notifyUserPersisted(
    assigneeAdminId,
    "New task assigned to you",
    `"${taskTitle}" in ${projectName} — assigned by ${actor.email}.`,
    "/admin_pro/projects",
    "hq_task",
  );
}

// POST /api/admin/projects/:id/tasks
router.post("/projects/:id/tasks", async (req: any, res): Promise<void> => {
  const project = await db.select().from(hqProjectsTable).where(eq(hqProjectsTable.id, req.params.id)).then((r) => r[0]);
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  const parsed = taskInputSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Task needs a title (max 200 chars)." });
    return;
  }
  if (parsed.data.assigneeAdminId && !(await isStaffId(parsed.data.assigneeAdminId))) {
    res.status(400).json({ error: "Assignee must be a staff member" });
    return;
  }
  const adminUser = req.adminUser as User;
  const id = randomUUID();
  await db.insert(hqTasksTable).values({
    id,
    projectId: project.id,
    title: parsed.data.title,
    detail: parsed.data.detail ?? null,
    assigneeAdminId: parsed.data.assigneeAdminId ?? null,
    dueAt: parsed.data.dueAt ? new Date(parsed.data.dueAt) : null,
    createdByAdminId: adminUser.id,
  });
  if (parsed.data.assigneeAdminId) {
    await notifyAssignment(parsed.data.assigneeAdminId, adminUser, parsed.data.title, project.name);
  }
  const created = await db.select().from(hqTasksTable).where(eq(hqTasksTable.id, id)).then((r) => r[0]);
  res.status(201).json({ ...created, commentCount: 0, assigneeEmail: null });
});

const taskUpdateSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  detail: z.string().trim().max(4000).nullable().optional(),
  status: z.enum(["todo", "in_progress", "done"]).optional(),
  assigneeAdminId: z.string().max(64).nullable().optional(),
  dueAt: z.string().datetime({ offset: true }).nullable().optional(),
});

// PATCH /api/admin/tasks/:id
router.patch("/tasks/:id", async (req: any, res): Promise<void> => {
  const task = await db.select().from(hqTasksTable).where(eq(hqTasksTable.id, req.params.id)).then((r) => r[0]);
  if (!task) {
    res.status(404).json({ error: "Task not found" });
    return;
  }
  const parsed = taskUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid task update" });
    return;
  }
  if (parsed.data.assigneeAdminId && !(await isStaffId(parsed.data.assigneeAdminId))) {
    res.status(400).json({ error: "Assignee must be a staff member" });
    return;
  }
  const adminUser = req.adminUser as User;
  const nextStatus = parsed.data.status;
  await db
    .update(hqTasksTable)
    .set({
      ...(parsed.data.title !== undefined ? { title: parsed.data.title } : {}),
      ...(parsed.data.detail !== undefined ? { detail: parsed.data.detail } : {}),
      ...(nextStatus !== undefined ? { status: nextStatus, completedAt: nextStatus === "done" ? new Date() : null } : {}),
      ...(parsed.data.assigneeAdminId !== undefined ? { assigneeAdminId: parsed.data.assigneeAdminId } : {}),
      ...(parsed.data.dueAt !== undefined ? { dueAt: parsed.data.dueAt ? new Date(parsed.data.dueAt) : null } : {}),
    })
    .where(eq(hqTasksTable.id, task.id));

  // A NEW assignee gets told; re-saving the same one stays quiet.
  if (parsed.data.assigneeAdminId && parsed.data.assigneeAdminId !== task.assigneeAdminId) {
    const project = await db.select().from(hqProjectsTable).where(eq(hqProjectsTable.id, task.projectId)).then((r) => r[0]);
    await notifyAssignment(parsed.data.assigneeAdminId, adminUser, parsed.data.title ?? task.title, project?.name ?? "a project");
  }

  const updated = await db.select().from(hqTasksTable).where(eq(hqTasksTable.id, task.id)).then((r) => r[0]);
  res.json(updated);
});

// DELETE /api/admin/tasks/:id
router.delete("/tasks/:id", async (req, res): Promise<void> => {
  const task = await db.select().from(hqTasksTable).where(eq(hqTasksTable.id, req.params.id)).then((r) => r[0]);
  if (!task) {
    res.status(404).json({ error: "Task not found" });
    return;
  }
  await db.delete(hqTaskCommentsTable).where(eq(hqTaskCommentsTable.taskId, task.id));
  await db.delete(hqTasksTable).where(eq(hqTasksTable.id, task.id));
  const adminUser = (req as any).adminUser as User;
  logAdminAction(adminUser.id, "hq_task.delete", { type: "hq_task", id: task.id }, { title: task.title, projectId: task.projectId });
  res.status(204).send();
});

// GET /api/admin/tasks/:id/comments
router.get("/tasks/:id/comments", async (req, res): Promise<void> => {
  const task = await db.select().from(hqTasksTable).where(eq(hqTasksTable.id, req.params.id)).then((r) => r[0]);
  if (!task) {
    res.status(404).json({ error: "Task not found" });
    return;
  }
  const comments = await db
    .select()
    .from(hqTaskCommentsTable)
    .where(eq(hqTaskCommentsTable.taskId, task.id))
    .orderBy(asc(hqTaskCommentsTable.createdAt));
  const authorIds = [...new Set(comments.map((c) => c.authorAdminId))];
  const authors = authorIds.length
    ? await db.select({ id: usersTable.id, email: usersTable.email }).from(usersTable).where(inArray(usersTable.id, authorIds))
    : [];
  const emailById = new Map(authors.map((a) => [a.id, a.email]));
  res.json({
    items: comments.map((c) => ({ ...c, authorEmail: emailById.get(c.authorAdminId) ?? null })),
  });
});

const commentInputSchema = z.object({ body: z.string().trim().min(1).max(2000) });

// POST /api/admin/tasks/:id/comments — commenting notifies the assignee
// (unless they're the one commenting), keeping the thread alive without
// anyone polling the board.
router.post("/tasks/:id/comments", async (req: any, res): Promise<void> => {
  const task = await db.select().from(hqTasksTable).where(eq(hqTasksTable.id, req.params.id)).then((r) => r[0]);
  if (!task) {
    res.status(404).json({ error: "Task not found" });
    return;
  }
  const parsed = commentInputSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Comment can't be empty (max 2000 chars)." });
    return;
  }
  const adminUser = req.adminUser as User;
  const id = randomUUID();
  await db.insert(hqTaskCommentsTable).values({ id, taskId: task.id, authorAdminId: adminUser.id, body: parsed.data.body });

  if (task.assigneeAdminId && task.assigneeAdminId !== adminUser.id) {
    await notifyUserPersisted(
      task.assigneeAdminId,
      "New comment on your task",
      `${adminUser.email} commented on "${task.title}".`,
      "/admin_pro/projects",
      "hq_task",
    );
  }

  const created = await db.select().from(hqTaskCommentsTable).where(eq(hqTaskCommentsTable.id, id)).then((r) => r[0]);
  res.status(201).json({ ...created, authorEmail: adminUser.email });
});

export default router;
