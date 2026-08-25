import { Router, type IRouter } from "express";
import { getAuth } from "@clerk/express";
import { db, bugIssuesTable, bugOccurrencesTable, usersTable } from "@workspace/db";
import { eq, desc, count } from "drizzle-orm";
import { z } from "zod";
import { requireAdmin, requirePermission } from "../lib/adminAuth";
import { ensureUser } from "../lib/ensureUser";
import { logAdminAction } from "../lib/adminAudit";
import { MAX_STORED_OCCURRENCES } from "../lib/bugRabbit";

const router: IRouter = Router();

// Own distinct prefix ("/admin/bug-rabbit", mounted in routes/index.ts) —
// same reasoning as adminTextWhisps.ts's own comment on why an unscoped
// router.use(requireAdmin) is safe here and would NOT be safe on the bare
// "/admin" router: this middleware only ever runs for requests that already
// matched this prefix.
router.use(requireAdmin);
router.use(requirePermission("bugrabbit"));

function parsePagination(req: any): { page: number; pageSize: number } {
  const page = Math.max(1, parseInt(String(req.query.page ?? "1"), 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(String(req.query.pageSize ?? "20"), 10) || 20));
  return { page, pageSize };
}

// GET /api/admin/bug-rabbit/issues — the queue. Default view is unresolved,
// most-recently-seen first (what's actively still happening); "frequency"
// sort surfaces the highest-occurrence issue instead, for triaging which
// bug is hurting the most people rather than which fired most recently.
router.get("/issues", async (req, res): Promise<void> => {
  const { page, pageSize } = parsePagination(req);
  const statusFilter = typeof req.query.status === "string" ? req.query.status : "unresolved";
  const sort = req.query.sort === "frequency" ? "frequency" : "recency";

  const where =
    statusFilter === "unresolved" ? eq(bugIssuesTable.resolved, false)
    : statusFilter === "resolved" ? eq(bugIssuesTable.resolved, true)
    : undefined;

  const [rows, totalRow] = await Promise.all([
    db
      .select()
      .from(bugIssuesTable)
      .where(where)
      .orderBy(sort === "frequency" ? desc(bugIssuesTable.occurrenceCount) : desc(bugIssuesTable.lastSeenAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ count: count() }).from(bugIssuesTable).where(where).then((r) => r[0]),
  ]);

  res.json({ items: rows, total: totalRow?.count ?? 0, page, pageSize });
});

// GET /api/admin/bug-rabbit/issues/:id — issue detail plus its most recent
// stored occurrences (capped at MAX_STORED_OCCURRENCES per issue at write
// time, see lib/bugRabbit.ts — nothing further to cap here).
router.get("/issues/:id", async (req, res): Promise<void> => {
  const issue = await db.select().from(bugIssuesTable).where(eq(bugIssuesTable.id, req.params.id)).then((r) => r[0]);
  if (!issue) {
    res.status(404).json({ error: "Issue not found" });
    return;
  }

  const occurrences = await db
    .select({
      id: bugOccurrencesTable.id,
      stack: bugOccurrencesTable.stack,
      url: bugOccurrencesTable.url,
      userAgent: bugOccurrencesTable.userAgent,
      userId: bugOccurrencesTable.userId,
      createdAt: bugOccurrencesTable.createdAt,
      userEmail: usersTable.email,
    })
    .from(bugOccurrencesTable)
    .leftJoin(usersTable, eq(bugOccurrencesTable.userId, usersTable.id))
    .where(eq(bugOccurrencesTable.issueId, issue.id))
    .orderBy(desc(bugOccurrencesTable.createdAt))
    .limit(MAX_STORED_OCCURRENCES);

  res.json({ issue, occurrences });
});

const updateIssueSchema = z.object({ resolved: z.boolean() });

// PATCH /api/admin/bug-rabbit/issues/:id — mark resolved/reopen. A resolved
// issue that fires AGAIN still increments its occurrenceCount and touches
// lastSeenAt (lib/bugRabbit.ts's recordBugReport doesn't check `resolved`
// at all) but stays out of the default "unresolved" queue view until
// someone notices it in the "all"/"resolved" filter and reopens it — a
// regression getting temporarily buried is a fair tradeoff against every
// resolve immediately un-resolving itself on the next occurrence, which
// would make "resolved" mean nothing for a bug that only reproduces rarely.
router.patch("/issues/:id", async (req, res): Promise<void> => {
  const parsed = updateIssueSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid update" });
    return;
  }

  const { userId } = getAuth(req);
  const admin = await ensureUser(userId!, req);

  const updated = await db
    .update(bugIssuesTable)
    .set(
      parsed.data.resolved
        ? { resolved: true, resolvedAt: new Date(), resolvedByAdminId: admin.id }
        : { resolved: false, resolvedAt: null, resolvedByAdminId: null },
    )
    .where(eq(bugIssuesTable.id, req.params.id))
    .returning()
    .then((r) => r[0]);

  if (!updated) {
    res.status(404).json({ error: "Issue not found" });
    return;
  }

  logAdminAction(admin.id, parsed.data.resolved ? "bug_issue.resolve" : "bug_issue.reopen", { type: "bug_issue", id: updated.id });
  res.json(updated);
});

export default router;
