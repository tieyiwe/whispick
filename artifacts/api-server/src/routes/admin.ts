import { Router } from "express";
import { z } from "zod";
import { randomUUID } from "crypto";
import {
  db,
  usersTable,
  whispsTable,
  whispRepliesTable,
  trackingEventsTable,
  creditTransactionsTable,
  whispCategoriesTable,
  pushSubscriptionsTable,
  circlesTable,
  circleMembersTable,
  suggestedVideosTable,
  suggestionAgentStatusTable,
  deliveryAttemptsTable,
  notificationsTable,
  moderationFlagsTable,
  conciergeRequestsTable,
  invitesTable,
  textWhispsTable,
  circleCommentsTable,
  debateTopicsTable,
  debateTopicCommentsTable,
  contentReportsTable,
  policyVersionsTable,
  policyAcceptancesTable,
  featureEventsTable,
  whisperBoxMessagesTable,
  type User,
} from "@workspace/db";
import { and, asc, count, desc, eq, gte, ilike, inArray, isNotNull, isNull, ne, or, sql } from "drizzle-orm";
import { requireAdmin, requirePermission, isOwner } from "../lib/adminAuth";
import { logAdminAction, listAdminAuditLog } from "../lib/adminAudit";
import { VIDEO_CATEGORIES } from "../lib/categorize";
import { computeOpportunities } from "../lib/insights";
import { resolveVideoMeta } from "../lib/videoMeta";
import { generateSuggestionSummaryAsync } from "../lib/suggestionSummary";
import { runSuggestionDiscoveryAgent } from "../lib/suggestionAgent";
import { notifyUser, notifyAllUsers, notifyUserPersisted } from "../lib/push";
import { fetchClerkProfile, isPlaceholderEmail } from "../lib/ensureUser";
import { aggregateFeatureUsage, generateUsageInsights } from "../lib/usageInsights";
import { sendEmail, adminAnnouncementEmailHtml } from "../lib/email";
import { httpUrlString, isHttpUrlOrAppPath } from "../lib/safeUrl";
import { complianceFlagsFor, matchesComplianceFilter, type ComplianceFilter } from "../lib/compliance";
import { isOnline, ONLINE_WINDOW_MS } from "../lib/presence";

const router = Router();

router.use(requireAdmin);

// Feature-area gates (lib/adminAuth.ts): the owner passes everything; a
// collaborator passes only the areas their grant carries. Prefixes mirror
// AdminLayout's nav groups one-to-one.
router.use("/users", requirePermission("users"));
router.use("/whisps", requirePermission("whisps"));
router.use("/moderation", requirePermission("moderation"));
router.use("/content-reports", requirePermission("reports"));
router.use("/notifications", requirePermission("notifications"));
router.use("/policy-versions", requirePermission("policies"));
router.use("/suggestions", requirePermission("suggestions"));
router.use("/stats", requirePermission("analytics"));
router.use("/usage-stats", requirePermission("analytics"));
router.use("/usage-insights", requirePermission("analytics"));
router.use("/audit-log", requirePermission("audit_log"));

function categoryLabel(key: string): string {
  return VIDEO_CATEGORIES.find((c) => c.key === key)?.label ?? "Uncategorized";
}

function parsePagination(req: any): { page: number; pageSize: number } {
  const page = Math.max(1, parseInt(String(req.query.page ?? "1"), 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(String(req.query.pageSize ?? "20"), 10) || 20));
  return { page, pageSize };
}

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

// GET /api/admin/users
const COMPLIANCE_FILTERS: ComplianceFilter[] = ["mfa_missing", "policy_pending", "email_unverified", "phone_unverified"];
// Compliance isn't a plain column — it's derived from a Clerk mirror plus a
// join against policy_versions/policy_acceptances — so filtering on it can't
// happen in the paginated SQL query above. Fetched and filtered in JS
// instead, capped well above any realistic admin page size at this app's
// scale; revisit with a real SQL join if the user base outgrows this.
const COMPLIANCE_FILTER_SCAN_LIMIT = 1000;

router.get("/users", async (req, res): Promise<void> => {
  const { page, pageSize } = parsePagination(req);
  const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
  const planFilter = typeof req.query.plan === "string" ? req.query.plan : undefined;
  const roleFilter = typeof req.query.role === "string" ? req.query.role : undefined;
  const bannedFilter = req.query.banned === "true" ? true : req.query.banned === "false" ? false : undefined;
  const complianceFilter = COMPLIANCE_FILTERS.includes(req.query.compliance as ComplianceFilter)
    ? (req.query.compliance as ComplianceFilter)
    : undefined;

  const conditions = [];
  if (search) conditions.push(or(ilike(usersTable.email, `%${search}%`), ilike(usersTable.fullName, `%${search}%`)));
  if (planFilter) conditions.push(eq(usersTable.plan, planFilter));
  if (roleFilter) conditions.push(eq(usersTable.role, roleFilter));
  if (bannedFilter !== undefined) conditions.push(eq(usersTable.banned, bannedFilter));
  const where = conditions.length ? and(...conditions) : undefined;

  if (complianceFilter) {
    const scanned = await db.select().from(usersTable).where(where).orderBy(desc(usersTable.createdAt)).limit(COMPLIANCE_FILTER_SCAN_LIMIT);
    const flagsById = await complianceFlagsFor(scanned);
    const matching = scanned.filter((u) => matchesComplianceFilter(flagsById[u.id]!, complianceFilter));
    const pageItems = matching.slice((page - 1) * pageSize, (page - 1) * pageSize + pageSize);
    res.json({
      items: pageItems.map((u) => ({ ...u, compliance: flagsById[u.id], online: isOnline(u.lastSeenAt) })),
      total: matching.length,
      page,
      pageSize,
    });
    return;
  }

  const [items, totalRow] = await Promise.all([
    db.select().from(usersTable).where(where).orderBy(desc(usersTable.createdAt)).limit(pageSize).offset((page - 1) * pageSize),
    db.select({ count: count() }).from(usersTable).where(where).then((r) => r[0]),
  ]);
  const flagsById = await complianceFlagsFor(items);

  res.json({
    items: items.map((u) => ({ ...u, compliance: flagsById[u.id], online: isOnline(u.lastSeenAt) })),
    total: totalRow?.count ?? 0,
    page,
    pageSize,
  });
});

// GET /api/admin/users/online-now — how many accounts have been active in
// the last ONLINE_WINDOW_MS, for the Analytics "online now" tile. Admin-only
// aggregate count — not gated by any individual's showOnlineStatus, which
// only governs whether OTHER USERS can see a specific person online, not
// whether the platform's own operators can see an anonymous headcount.
router.get("/users/online-now", async (_req, res): Promise<void> => {
  const [{ count: onlineCount } = { count: 0 }] = await db
    .select({ count: count() })
    .from(usersTable)
    .where(gte(usersTable.lastSeenAt, new Date(Date.now() - ONLINE_WINDOW_MS)));
  res.json({ onlineCount, windowMinutes: ONLINE_WINDOW_MS / 60_000 });
});

const COMPLIANCE_REMINDER_COPY: Record<ComplianceFilter, { title: string; body: string; url: string }> = {
  mfa_missing: {
    title: "Turn on two-factor authentication",
    body: "Add an authenticator app to your account in Settings → Account & Security — it only takes a minute and keeps your account a lot safer.",
    url: "/account/security",
  },
  policy_pending: {
    title: "Please review our updated policy",
    body: "We've updated our Privacy Policy or Terms — open the app to review and accept before you continue.",
    url: "/dashboard",
  },
  email_unverified: {
    title: "We couldn't confirm your email",
    body: "Your account's email on file looks off, which means you may be missing important notifications. Please check it in Settings.",
    url: "/settings",
  },
  phone_unverified: {
    title: "Verify your phone number",
    body: "Verifying your phone lets Text Whisps and Whisper Links reach you directly instead of as a guest link. Add it in Settings.",
    url: "/settings",
  },
};

const complianceReminderSchema = z.object({
  userIds: z.array(z.string().max(64)).min(1).max(200),
  kind: z.enum(["mfa_missing", "policy_pending", "email_unverified", "phone_unverified"]),
});

// POST /api/admin/users/compliance-reminder — nudge specific users (one or
// many, from the Users compliance dashboard) about a single missing thing.
// Same persisted-notification-plus-email shape as POST /notifications, just
// pre-written per compliance kind rather than admin-authored. Never verifies
// the flag is still true server-side before sending — a reminder sent a
// moment after someone already fixed it is a harmless no-op, not worth the
// extra query on every send.
router.post("/users/compliance-reminder", async (req, res): Promise<void> => {
  const parsed = complianceReminderSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const adminUser = (req as any).adminUser as User;
  const { title, body, url } = COMPLIANCE_REMINDER_COPY[parsed.data.kind];
  const userIds = [...new Set(parsed.data.userIds)];

  const recipients = await db.select().from(usersTable).where(inArray(usersTable.id, userIds));

  await db.insert(notificationsTable).values(
    recipients.map((r) => ({ id: randomUUID(), targetUserId: r.id, title, body, url, createdByAdminId: adminUser.id })),
  );
  const perUserCounts = await Promise.all(recipients.map((r) => notifyUser(r.id, title, body, url)));
  const pushDelivered = perUserCounts.reduce((sum, n) => sum + n, 0);

  let emailsSent = 0;
  let emailsSkipped = 0;
  const html = adminAnnouncementEmailHtml(title, body, url);
  for (const r of recipients) {
    if (!r.emailNotificationsEnabled || r.banned || isPlaceholderEmail(r.email, r.clerkId)) {
      emailsSkipped++;
      continue;
    }
    const ok = await sendEmail(r.email, title, html, { whispId: null, purpose: "admin_announcement" });
    if (ok) emailsSent++;
    else emailsSkipped++;
  }

  logAdminAction(adminUser.id, "users.compliance_reminder", { type: "user", id: "batch" }, { kind: parsed.data.kind, recipientCount: recipients.length, pushDelivered, emailsSent, emailsSkipped });

  res.status(201).json({ recipientCount: recipients.length, pushDelivered, emailsSent, emailsSkipped });
});

// GET /api/admin/users/:id — everything needed to answer "what happened
// with this person's account" at a glance: a preview of recent whisps (see
// GET /users/:id/whisps for the full, paginated, filterable history),
// credit transaction history, a whisp-status breakdown across ALL of their
// whisps (so "3 failed deliveries" is visible without paging through every
// whisp), and how many replies they've ever received.
router.get("/users/:id", async (req, res): Promise<void> => {
  const user = await db.select().from(usersTable).where(eq(usersTable.id, req.params.id)).then((r) => r[0]);
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  const [recentWhisps, totalWhispsRow, creditTransactions, statusRows, totalRepliesRow, moderationFlagRows, debateTopics, debateTopicComments] = await Promise.all([
    db.select().from(whispsTable).where(eq(whispsTable.senderId, user.id)).orderBy(desc(whispsTable.createdAt)).limit(50),
    db.select({ count: count() }).from(whispsTable).where(eq(whispsTable.senderId, user.id)).then((r) => r[0]),
    db.select().from(creditTransactionsTable).where(eq(creditTransactionsTable.userId, user.id)).orderBy(desc(creditTransactionsTable.createdAt)).limit(50),
    db.select({ status: whispsTable.status, count: count() }).from(whispsTable).where(eq(whispsTable.senderId, user.id)).groupBy(whispsTable.status),
    db
      .select({ count: count() })
      .from(whispRepliesTable)
      .innerJoin(whispsTable, eq(whispRepliesTable.whispId, whispsTable.id))
      .where(eq(whispsTable.senderId, user.id))
      .then((r) => r[0]),
    // Every content-safety flag on this user's whisps, text whisps, circle
    // comments, and debate topics/comments they posted while signed in,
    // dismissed or not — an admin reviewing one flag can see this person's
    // full flag history right here instead of hunting for it in the
    // site-wide queue. leftJoin (not innerJoin) on every content table since
    // a flag row only ever has one of whispId/textWhispId/circleCommentId/
    // debateTopicId/debateTopicCommentId set (see moderation_flags.ts's
    // contentType) — an innerJoin on any one alone would silently drop the
    // other content types' flags.
    db
      .select({
        id: moderationFlagsTable.id,
        whispId: moderationFlagsTable.whispId,
        textWhispId: moderationFlagsTable.textWhispId,
        debateTopicId: moderationFlagsTable.debateTopicId,
        debateTopicCommentId: moderationFlagsTable.debateTopicCommentId,
        contentType: moderationFlagsTable.contentType,
        userId: moderationFlagsTable.userId,
        severity: moderationFlagsTable.severity,
        reasoning: moderationFlagsTable.reasoning,
        source: moderationFlagsTable.source,
        dismissed: moderationFlagsTable.dismissed,
        reviewedAt: moderationFlagsTable.reviewedAt,
        reviewedByAdminId: moderationFlagsTable.reviewedByAdminId,
        createdAt: moderationFlagsTable.createdAt,
        videoTitle: whispsTable.videoTitle,
        textWhispMessage: textWhispsTable.messageText,
        circleCommentText: circleCommentsTable.commentText,
        debateTopicText: debateTopicsTable.topicText,
        debateTopicCommentText: debateTopicCommentsTable.commentText,
      })
      .from(moderationFlagsTable)
      .leftJoin(whispsTable, eq(moderationFlagsTable.whispId, whispsTable.id))
      .leftJoin(textWhispsTable, eq(moderationFlagsTable.textWhispId, textWhispsTable.id))
      .leftJoin(circleCommentsTable, eq(moderationFlagsTable.circleCommentId, circleCommentsTable.id))
      .leftJoin(debateTopicsTable, eq(moderationFlagsTable.debateTopicId, debateTopicsTable.id))
      .leftJoin(debateTopicCommentsTable, eq(moderationFlagsTable.debateTopicCommentId, debateTopicCommentsTable.id))
      .where(eq(moderationFlagsTable.userId, user.id))
      .orderBy(desc(moderationFlagsTable.createdAt)),
    // Debate Topics/comments this account authored — never shown to the
    // public (authorId is stripped everywhere in routes/debateTopics.ts),
    // but useful for an investigation same as their whisps are. Bounded to
    // the most recent 50, same posture as recentWhisps above.
    db
      .select({ id: debateTopicsTable.id, topicText: debateTopicsTable.topicText, createdAt: debateTopicsTable.createdAt, deletedByAuthorAt: debateTopicsTable.deletedByAuthorAt, removedByAdminAt: debateTopicsTable.removedByAdminAt })
      .from(debateTopicsTable)
      .where(eq(debateTopicsTable.authorId, user.id))
      .orderBy(desc(debateTopicsTable.createdAt))
      .limit(50),
    db
      .select({ id: debateTopicCommentsTable.id, topicId: debateTopicCommentsTable.topicId, commentText: debateTopicCommentsTable.commentText, createdAt: debateTopicCommentsTable.createdAt, removedByAdminAt: debateTopicCommentsTable.removedByAdminAt })
      .from(debateTopicCommentsTable)
      .where(eq(debateTopicCommentsTable.authorUserId, user.id))
      .orderBy(desc(debateTopicCommentsTable.createdAt))
      .limit(50),
  ]);

  const flagsById = await complianceFlagsFor([user]);

  res.json({
    user: { ...user, compliance: flagsById[user.id], online: isOnline(user.lastSeenAt) },
    recentWhisps,
    totalWhisps: totalWhispsRow?.count ?? 0,
    creditTransactions,
    statusCounts: Object.fromEntries(statusRows.map((r) => [r.status, r.count])),
    totalReplies: totalRepliesRow?.count ?? 0,
    moderationFlagCount: moderationFlagRows.filter((f) => !f.dismissed).length,
    moderationFlags: moderationFlagRows,
    debateTopics,
    debateTopicComments,
  });
});

// Attaches categories + reply counts to a page of whisp rows — shared by
// GET /whisps and GET /users/:id/whisps so both the site-wide content
// browser and a single user's activity timeline render the same shape.
async function enrichWhispList<T extends { id: string; senderId: string }>(
  items: T[],
  opts: { includeSenderEmail: boolean },
): Promise<Array<T & { senderEmail: string | null; categories: unknown[]; replyCount: number }>> {
  const whispIds = items.map((w) => w.id);
  if (!whispIds.length) return [];

  const [senders, categories, replyRows] = await Promise.all([
    opts.includeSenderEmail
      ? db
          .select({ id: usersTable.id, email: usersTable.email })
          .from(usersTable)
          .where(inArray(usersTable.id, [...new Set(items.map((w) => w.senderId))]))
      : Promise.resolve([]),
    db.select().from(whispCategoriesTable).where(inArray(whispCategoriesTable.whispId, whispIds)).orderBy(asc(whispCategoriesTable.rank)),
    db
      .select({ whispId: whispRepliesTable.whispId, count: count() })
      .from(whispRepliesTable)
      .where(inArray(whispRepliesTable.whispId, whispIds))
      .groupBy(whispRepliesTable.whispId),
  ]);

  const senderEmailById = Object.fromEntries(senders.map((s) => [s.id, s.email]));
  const categoriesByWhisp: Record<string, typeof categories> = {};
  for (const c of categories) (categoriesByWhisp[c.whispId] ??= []).push(c);
  const replyCountByWhisp = Object.fromEntries(replyRows.map((r) => [r.whispId, r.count]));

  return items.map((w) => ({
    ...w,
    senderEmail: senderEmailById[w.senderId] ?? null,
    categories: categoriesByWhisp[w.id] ?? [],
    replyCount: replyCountByWhisp[w.id] ?? 0,
  }));
}

// GET /api/admin/users/:id/whisps — the full per-user activity timeline:
// every whisp this user ever sent, across every delivery method
// (whisper_link, ghost_boost, circle_drop, group_whisper), with recipient
// contact info, delivery/open/watch timestamps, reveal flow state,
// appreciation response, and reply count all on each row — everything
// support needs to answer "what happened when this person sent things"
// without opening each whisp individually.
router.get("/users/:id/whisps", async (req, res): Promise<void> => {
  const user = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.id, req.params.id)).then((r) => r[0]);
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  const { page, pageSize } = parsePagination(req);
  const statusFilter = typeof req.query.status === "string" ? req.query.status : undefined;
  const deliveryFilter = typeof req.query.deliveryMethod === "string" ? req.query.deliveryMethod : undefined;

  const conditions = [eq(whispsTable.senderId, user.id)];
  if (statusFilter) conditions.push(eq(whispsTable.status, statusFilter));
  if (deliveryFilter) conditions.push(eq(whispsTable.deliveryMethod, deliveryFilter));
  const where = and(...conditions);

  const [items, totalRow] = await Promise.all([
    db.select().from(whispsTable).where(where).orderBy(desc(whispsTable.createdAt)).limit(pageSize).offset((page - 1) * pageSize),
    db.select({ count: count() }).from(whispsTable).where(where).then((r) => r[0]),
  ]);

  res.json({
    items: await enrichWhispList(items, { includeSenderEmail: false }),
    total: totalRow?.count ?? 0,
    page,
    pageSize,
  });
});

const updateUserSchema = z.object({
  role: z.enum(["user", "admin"]).optional(),
  plan: z.enum(["free", "spark", "ember"]).optional(),
  boostCredits: z.number().int().min(0).optional(),
  banned: z.boolean().optional(),
});

// PATCH /api/admin/users/:id
router.patch("/users/:id", async (req, res): Promise<void> => {
  const target = await db.select().from(usersTable).where(eq(usersTable.id, req.params.id)).then((r) => r[0]);
  if (!target) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  const parsed = updateUserSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const adminUser = (req as any).adminUser as User;
  if (target.id === adminUser.id && (parsed.data.banned === true || parsed.data.role === "user")) {
    res.status(400).json({ error: "You can't ban or demote your own account" });
    return;
  }

  // The super admin account is managed by ADMIN_EMAILS, never from here —
  // without this, any collaborator holding the `users` permission could ban
  // or demote the owner and take over the HQ.
  if (isOwner(target) && (parsed.data.banned === true || parsed.data.role === "user")) {
    res.status(403).json({ error: "The super admin account can't be banned or demoted" });
    return;
  }
  // Role changes (promoting to admin, demoting an admin) are the owner's
  // call alone — otherwise a collaborator could mint admins entirely outside
  // the Staff & Access grant system. Same for banning a fellow admin.
  const targetsAdmin = target.role === "admin" || parsed.data.role === "admin";
  if (!(req as any).adminIsOwner && targetsAdmin && (parsed.data.role !== undefined || parsed.data.banned !== undefined)) {
    res.status(403).json({ error: "Only the super admin can change staff roles or ban staff accounts", code: "admin_owner_required" });
    return;
  }

  await db.update(usersTable).set(parsed.data).where(eq(usersTable.id, target.id));
  const updated = await db.select().from(usersTable).where(eq(usersTable.id, target.id)).then((r) => r[0]);

  if (parsed.data.banned !== undefined || parsed.data.role !== undefined || parsed.data.plan !== undefined || parsed.data.boostCredits !== undefined) {
    logAdminAction(adminUser.id, "user.update", { type: "user", id: target.id }, { before: { banned: target.banned, role: target.role, plan: target.plan, boostCredits: target.boostCredits }, after: parsed.data });
  }

  res.json(updated);
});

// DELETE /api/admin/users/:id — cascades the user's whisps and everything
// hanging off them. Circles they own are removed too; whisps other members
// dropped into an owned circle keep a dangling circleId (this schema has no
// enforced foreign keys anywhere, so that's consistent with the rest of the
// app rather than a new gap).
router.delete("/users/:id", async (req, res): Promise<void> => {
  const target = await db.select().from(usersTable).where(eq(usersTable.id, req.params.id)).then((r) => r[0]);
  if (!target) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  const adminUser = (req as any).adminUser as User;
  if (target.id === adminUser.id) {
    res.status(400).json({ error: "You can't delete your own account from here" });
    return;
  }

  // Same protections as PATCH: the owner is untouchable, and staff accounts
  // can only be deleted by the owner.
  if (isOwner(target)) {
    res.status(403).json({ error: "The super admin account can't be deleted" });
    return;
  }
  if (!(req as any).adminIsOwner && target.role === "admin") {
    res.status(403).json({ error: "Only the super admin can delete staff accounts", code: "admin_owner_required" });
    return;
  }

  const whisps = await db.select({ id: whispsTable.id }).from(whispsTable).where(eq(whispsTable.senderId, target.id));
  const whispIds = whisps.map((w) => w.id);

  if (whispIds.length) {
    await db.delete(trackingEventsTable).where(inArray(trackingEventsTable.whispId, whispIds));
    await db.delete(whispRepliesTable).where(inArray(whispRepliesTable.whispId, whispIds));
    await db.delete(whispCategoriesTable).where(inArray(whispCategoriesTable.whispId, whispIds));
  }

  await db.delete(whispsTable).where(eq(whispsTable.senderId, target.id));
  await db.delete(creditTransactionsTable).where(eq(creditTransactionsTable.userId, target.id));
  await db.delete(pushSubscriptionsTable).where(eq(pushSubscriptionsTable.userId, target.id));
  await db.delete(circleMembersTable).where(eq(circleMembersTable.userId, target.id));
  await db.delete(circlesTable).where(eq(circlesTable.ownerId, target.id));
  await db.delete(usersTable).where(eq(usersTable.id, target.id));

  logAdminAction(adminUser.id, "user.delete", { type: "user", id: target.id }, { email: target.email });

  res.status(204).send();
});

// ---------------------------------------------------------------------------
// Whisps (content moderation)
// ---------------------------------------------------------------------------

// GET /api/admin/whisps
router.get("/whisps", async (req, res): Promise<void> => {
  const { page, pageSize } = parsePagination(req);
  const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
  // Finds every whisp sent to a given contact regardless of who sent it or
  // which account (if any) they hold — the support-desk case of "I never
  // got my link," where the person reporting the issue is the recipient,
  // not necessarily an app user at all.
  const recipient = typeof req.query.recipient === "string" ? req.query.recipient.trim() : "";
  const statusFilter = typeof req.query.status === "string" ? req.query.status : undefined;
  const deliveryFilter = typeof req.query.deliveryMethod === "string" ? req.query.deliveryMethod : undefined;
  const categoryFilter = typeof req.query.category === "string" ? req.query.category : undefined;

  const conditions = [];
  if (search) conditions.push(ilike(whispsTable.videoTitle, `%${search}%`));
  if (recipient) conditions.push(or(ilike(whispsTable.recipientEmail, `%${recipient}%`), ilike(whispsTable.recipientPhone, `%${recipient}%`)));
  if (statusFilter) conditions.push(eq(whispsTable.status, statusFilter));
  if (deliveryFilter) conditions.push(eq(whispsTable.deliveryMethod, deliveryFilter));

  if (categoryFilter) {
    const rows = await db
      .select({ whispId: whispCategoriesTable.whispId })
      .from(whispCategoriesTable)
      .where(eq(whispCategoriesTable.category, categoryFilter));
    const ids = rows.map((r) => r.whispId);
    if (!ids.length) {
      res.json({ items: [], total: 0, page, pageSize });
      return;
    }
    conditions.push(inArray(whispsTable.id, ids));
  }

  const where = conditions.length ? and(...conditions) : undefined;

  const [items, totalRow] = await Promise.all([
    db.select().from(whispsTable).where(where).orderBy(desc(whispsTable.createdAt)).limit(pageSize).offset((page - 1) * pageSize),
    db.select({ count: count() }).from(whispsTable).where(where).then((r) => r[0]),
  ]);

  res.json({
    items: await enrichWhispList(items, { includeSenderEmail: true }),
    total: totalRow?.count ?? 0,
    page,
    pageSize,
  });
});

// GET /api/admin/whisps/:id
router.get("/whisps/:id", async (req, res): Promise<void> => {
  const whisp = await db.select().from(whispsTable).where(eq(whispsTable.id, req.params.id)).then((r) => r[0]);
  if (!whisp) {
    res.status(404).json({ error: "Whisp not found" });
    return;
  }

  const [sender, trackingEvents, replies, categories, deliveryAttempts, moderationFlags] = await Promise.all([
    db.select().from(usersTable).where(eq(usersTable.id, whisp.senderId)).then((r) => r[0]),
    db.select().from(trackingEventsTable).where(eq(trackingEventsTable.whispId, whisp.id)).orderBy(asc(trackingEventsTable.createdAt)),
    db.select().from(whispRepliesTable).where(eq(whispRepliesTable.whispId, whisp.id)).orderBy(asc(whispRepliesTable.createdAt)),
    db.select().from(whispCategoriesTable).where(eq(whispCategoriesTable.whispId, whisp.id)).orderBy(asc(whispCategoriesTable.rank)),
    // Every Twilio/Resend send attempt tied to this whisp — the initial
    // send plus any reminders — so an admin can see exactly why a delivery
    // did or didn't go out (accepted sid/status, or the provider's error)
    // without reading server logs.
    db.select().from(deliveryAttemptsTable).where(eq(deliveryAttemptsTable.whispId, whisp.id)).orderBy(asc(deliveryAttemptsTable.createdAt)),
    db.select().from(moderationFlagsTable).where(eq(moderationFlagsTable.whispId, whisp.id)).orderBy(desc(moderationFlagsTable.createdAt)),
  ]);

  res.json({
    whisp,
    senderId: sender?.id ?? null,
    senderEmail: sender?.email ?? null,
    senderFullName: sender?.fullName ?? null,
    trackingEvents,
    replies,
    categories,
    deliveryAttempts,
    moderationFlags: moderationFlags.map((f) => ({ ...f, videoTitle: whisp.videoTitle, senderEmail: sender?.email ?? null })),
  });
});

// DELETE /api/admin/whisps/:id — moderation removal
router.delete("/whisps/:id", async (req, res): Promise<void> => {
  const whisp = await db.select().from(whispsTable).where(eq(whispsTable.id, req.params.id)).then((r) => r[0]);
  if (!whisp) {
    res.status(404).json({ error: "Whisp not found" });
    return;
  }

  await db.delete(trackingEventsTable).where(eq(trackingEventsTable.whispId, whisp.id));
  await db.delete(whispRepliesTable).where(eq(whispRepliesTable.whispId, whisp.id));
  await db.delete(whispCategoriesTable).where(eq(whispCategoriesTable.whispId, whisp.id));
  await db.delete(whispsTable).where(eq(whispsTable.id, whisp.id));

  const adminUser = (req as any).adminUser as User;
  logAdminAction(adminUser.id, "whisp.delete", { type: "whisp", id: whisp.id }, { videoTitle: whisp.videoTitle, senderId: whisp.senderId });

  res.status(204).send();
});

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

// GET /api/admin/stats/overview
router.get("/stats/overview", async (_req, res): Promise<void> => {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const [totalUsersRow, totalWhispsRow, bannedRow, activeLast7Row, newLast30Row, purchaseCountRow, planGrantCountRow] = await Promise.all([
    db.select({ count: count() }).from(usersTable).then((r) => r[0]),
    db.select({ count: count() }).from(whispsTable).then((r) => r[0]),
    db.select({ count: count() }).from(usersTable).where(eq(usersTable.banned, true)).then((r) => r[0]),
    db.select({ count: count() }).from(usersTable).where(gte(usersTable.lastSeenAt, sevenDaysAgo)).then((r) => r[0]),
    db.select({ count: count() }).from(usersTable).where(gte(usersTable.createdAt, thirtyDaysAgo)).then((r) => r[0]),
    db.select({ count: count() }).from(creditTransactionsTable).where(eq(creditTransactionsTable.type, "purchase")).then((r) => r[0]),
    db.select({ count: count() }).from(creditTransactionsTable).where(eq(creditTransactionsTable.type, "plan_grant")).then((r) => r[0]),
  ]);

  const planRows = await db.select({ plan: usersTable.plan, count: count() }).from(usersTable).groupBy(usersTable.plan);

  const signupTrend = await db
    .select({ day: sql<string>`to_char(${usersTable.createdAt}, 'YYYY-MM-DD')`, count: count() })
    .from(usersTable)
    .where(gte(usersTable.createdAt, thirtyDaysAgo))
    .groupBy(sql`to_char(${usersTable.createdAt}, 'YYYY-MM-DD')`)
    .orderBy(sql`to_char(${usersTable.createdAt}, 'YYYY-MM-DD')`);

  const whispTrend = await db
    .select({ day: sql<string>`to_char(${whispsTable.createdAt}, 'YYYY-MM-DD')`, count: count() })
    .from(whispsTable)
    .where(gte(whispsTable.createdAt, thirtyDaysAgo))
    .groupBy(sql`to_char(${whispsTable.createdAt}, 'YYYY-MM-DD')`)
    .orderBy(sql`to_char(${whispsTable.createdAt}, 'YYYY-MM-DD')`);

  res.json({
    totalUsers: totalUsersRow?.count ?? 0,
    totalWhisps: totalWhispsRow?.count ?? 0,
    bannedUsers: bannedRow?.count ?? 0,
    activeUsersLast7Days: activeLast7Row?.count ?? 0,
    newUsersLast30Days: newLast30Row?.count ?? 0,
    // Counts, not a dollar figure: credit_transactions stores credit
    // quantities, not the USD amount charged, so a revenue total here would
    // be a guess dressed up as a fact.
    creditPackPurchases: purchaseCountRow?.count ?? 0,
    planGrants: planGrantCountRow?.count ?? 0,
    usersByPlan: Object.fromEntries(planRows.map((p) => [p.plan, p.count])),
    signupTrend,
    whispTrend,
  });
});

// GET /api/admin/stats/categories
router.get("/stats/categories", async (_req, res): Promise<void> => {
  const rows = await db
    .select({
      category: whispCategoriesTable.category,
      totalTags: count(),
      primaryCount: sql<number>`count(*) filter (where ${whispCategoriesTable.rank} = 1)`,
      secondaryCount: sql<number>`count(*) filter (where ${whispCategoriesTable.rank} = 2)`,
      tertiaryCount: sql<number>`count(*) filter (where ${whispCategoriesTable.rank} = 3)`,
      weightedScore: sql<number>`sum(case when ${whispCategoriesTable.rank} = 1 then 3 when ${whispCategoriesTable.rank} = 2 then 2 else 1 end)`,
    })
    .from(whispCategoriesTable)
    .groupBy(whispCategoriesTable.category)
    .orderBy(desc(sql`sum(case when ${whispCategoriesTable.rank} = 1 then 3 when ${whispCategoriesTable.rank} = 2 then 2 else 1 end)`));

  res.json({
    categories: rows.map((r) => ({ ...r, label: categoryLabel(r.category) })),
  });
});

// GET /api/admin/stats/delivery-methods
router.get("/stats/delivery-methods", async (_req, res): Promise<void> => {
  const methodRows = await db
    .select({ method: whispsTable.deliveryMethod, count: count() })
    .from(whispsTable)
    .groupBy(whispsTable.deliveryMethod)
    .orderBy(desc(count()));

  const channelRows = await db
    .select({ channel: whispsTable.whisperChannel, count: count() })
    .from(whispsTable)
    .where(and(eq(whispsTable.deliveryMethod, "whisper_link"), isNotNull(whispsTable.whisperChannel)))
    .groupBy(whispsTable.whisperChannel)
    .orderBy(desc(count()));

  const total = methodRows.reduce((s, r) => s + r.count, 0);

  res.json({
    methods: methodRows.map((r) => ({
      method: r.method,
      count: r.count,
      percentage: total ? Math.round((r.count / total) * 1000) / 10 : 0,
    })),
    whisperLinkChannels: channelRows,
  });
});

// GET /api/admin/stats/locations
router.get("/stats/locations", async (_req, res): Promise<void> => {
  const [byCountry, byRegion, byCity, unknownRow, totalRow] = await Promise.all([
    db
      .select({ country: usersTable.country, count: count() })
      .from(usersTable)
      .where(isNotNull(usersTable.country))
      .groupBy(usersTable.country)
      .orderBy(desc(count()))
      .limit(25),
    // Region names (e.g. "CA", "Ontario") aren't unique without their
    // country, same reasoning as byCity below.
    db
      .select({ region: usersTable.region, country: usersTable.country, count: count() })
      .from(usersTable)
      .where(isNotNull(usersTable.region))
      .groupBy(usersTable.region, usersTable.country)
      .orderBy(desc(count()))
      .limit(25),
    db
      .select({ city: usersTable.city, country: usersTable.country, count: count() })
      .from(usersTable)
      .where(isNotNull(usersTable.city))
      .groupBy(usersTable.city, usersTable.country)
      .orderBy(desc(count()))
      .limit(25),
    db.select({ count: count() }).from(usersTable).where(isNull(usersTable.country)).then((r) => r[0]),
    db.select({ count: count() }).from(usersTable).then((r) => r[0]),
  ]);

  res.json({
    byCountry,
    byRegion,
    byCity,
    unknownLocationUsers: unknownRow?.count ?? 0,
    totalUsers: totalRow?.count ?? 0,
  });
});

// GET /api/admin/stats/demographics — self-reported gender/age-range,
// collected once via the gate before a user's first whisp send (see
// lib/demographics.ts). Never populated for a user who hasn't sent a whisp
// yet, same "one-time, best-effort" spirit as the IP-geolocation stats above.
router.get("/stats/demographics", async (_req, res): Promise<void> => {
  const [byGender, byAgeRange, unansweredRow, totalRow] = await Promise.all([
    db
      .select({ value: usersTable.gender, count: count() })
      .from(usersTable)
      .where(isNotNull(usersTable.gender))
      .groupBy(usersTable.gender)
      .orderBy(desc(count())),
    db
      .select({ value: usersTable.ageRange, count: count() })
      .from(usersTable)
      .where(isNotNull(usersTable.ageRange))
      .groupBy(usersTable.ageRange)
      .orderBy(desc(count())),
    db.select({ count: count() }).from(usersTable).where(isNull(usersTable.gender)).then((r) => r[0]),
    db.select({ count: count() }).from(usersTable).then((r) => r[0]),
  ]);

  res.json({
    byGender,
    byAgeRange,
    unansweredUsers: unansweredRow?.count ?? 0,
    totalUsers: totalRow?.count ?? 0,
  });
});

// GET /api/admin/stats/opportunities
router.get("/stats/opportunities", async (_req, res): Promise<void> => {
  const insights = await computeOpportunities();
  res.json({ insights });
});

// GET /api/admin/stats/funnel — the operational picture the other /stats
// endpoints don't cover: does delivery actually work (by channel), how far
// through sent → delivered → opened → watched → replied whisps get, and how
// much volume Ghost Boost matching and Circles are actually driving.
router.get("/stats/funnel", async (_req, res): Promise<void> => {
  // Circle Drop has no single recipient to fall off for — it's posted to a
  // shared feed, not delivered to one address — so it's excluded from the
  // recipient-directed funnel below and reported separately.
  const recipientDirected = ne(whispsTable.deliveryMethod, "circle_drop");

  const [funnelRow, channelRows, ghostBoostRow, circleCountRow, memberCountRow, dropsRow, conciergeRequestRow, conciergeMatchedRow, conciergeSendsRow, phoneMatchRoutingRow, inviteRow, textWhispRow] = await Promise.all([
    db
      .select({
        sent: count(),
        delivered: sql<number>`count(*) filter (where ${whispsTable.deliveredAt} is not null)`.mapWith(Number),
        failed: sql<number>`count(*) filter (where ${whispsTable.status} = 'failed')`.mapWith(Number),
        opened: sql<number>`count(*) filter (where ${whispsTable.openedAt} is not null)`.mapWith(Number),
        watched: sql<number>`count(*) filter (where ${whispsTable.watchedAt} is not null)`.mapWith(Number),
        replied: sql<number>`count(*) filter (where ${whispsTable.status} = 'replied')`.mapWith(Number),
        appreciated: sql<number>`count(*) filter (where ${whispsTable.appreciationResponse} = 'yes')`.mapWith(Number),
      })
      .from(whispsTable)
      .where(recipientDirected)
      .then((r) => r[0]!),
    db
      .select({
        channel: deliveryAttemptsTable.channel,
        attempts: count(),
        succeeded: sql<number>`count(*) filter (where ${deliveryAttemptsTable.success})`.mapWith(Number),
      })
      .from(deliveryAttemptsTable)
      .groupBy(deliveryAttemptsTable.channel)
      .orderBy(desc(count())),
    db
      .select({
        campaigns: sql<number>`count(*) filter (where ${whispsTable.groupSendId} is null)`.mapWith(Number),
        totalMatched: sql<number>`count(*) filter (where ${whispsTable.groupSendId} is not null)`.mapWith(Number),
      })
      .from(whispsTable)
      .where(eq(whispsTable.deliveryMethod, "ghost_boost"))
      .then((r) => r[0]!),
    db.select({ count: count() }).from(circlesTable).then((r) => r[0]),
    db.select({ count: count() }).from(circleMembersTable).then((r) => r[0]),
    db
      .select({ count: count() })
      .from(whispsTable)
      .where(eq(whispsTable.deliveryMethod, "circle_drop"))
      .then((r) => r[0]),
    // "Not sure what to send?" concierge usage (lib/concierge.ts) — kept in
    // the same funnel endpoint rather than a whole new admin section, per
    // the product ask for lightweight visibility.
    db.select({ count: count() }).from(conciergeRequestsTable).then((r) => r[0]),
    db
      .select({ count: count() })
      .from(conciergeRequestsTable)
      .where(sql`cardinality(${conciergeRequestsTable.suggestedVideoIds}) > 0`)
      .then((r) => r[0]),
    db.select({ count: count() }).from(whispsTable).where(isNotNull(whispsTable.conciergeRequestId)).then((r) => r[0]),
    // Proof the Twilio-skip matching in lib/deliver.ts is actually saving
    // money: every SMS/WhatsApp send attempt tied to a whisper_link or
    // group_whisper whisp, split by whether it went in-app (matched a known,
    // OTP-verified recipient) or through Twilio (unmatched) — covers every
    // purpose (initial send, reminders, reveal-request, reply-to-recipient),
    // not just the first message, since deliverWhisperLink funnels all of
    // them through the same matching check.
    db
      .select({
        inApp: sql<number>`count(*) filter (where ${deliveryAttemptsTable.channel} = 'in_app')`.mapWith(Number),
        twilio: sql<number>`count(*) filter (where ${deliveryAttemptsTable.channel} in ('sms', 'whatsapp'))`.mapWith(Number),
      })
      .from(deliveryAttemptsTable)
      .innerJoin(whispsTable, eq(deliveryAttemptsTable.whispId, whispsTable.id))
      .where(inArray(whispsTable.deliveryMethod, ["whisper_link", "group_whisper"]))
      .then((r) => r[0]!),
    // Anonymous invite-a-friend (routes/invites.ts) — volume and how many
    // actually converted into a real account, same lightweight
    // add-a-field-to-the-existing-funnel-endpoint treatment as concierge
    // above rather than a whole new admin section.
    db
      .select({
        sent: count(),
        joined: sql<number>`count(*) filter (where ${invitesTable.status} = 'joined')`.mapWith(Number),
      })
      .from(invitesTable)
      .then((r) => r[0]!),
    // Text Whisps (routes/textWhisps.ts) — a parallel, text-only content
    // type, not folded into the whisp funnel above since it isn't a whisp:
    // volume and how far it gets read/replied, plus the same
    // in-app-vs-guest split phoneMatchRouting reports for regular whisps —
    // deliveredInApp counts rows whose recipient was already a known,
    // verified account at send time (recipientUserId set); deliveredGuest
    // counts rows sent to a phone number that wasn't (recipientUserId null,
    // delivered as a public guest link instead — see
    // lib/db/src/schema/text_whisps.ts's dual-path comment).
    db
      .select({
        sent: count(),
        read: sql<number>`count(*) filter (where ${textWhispsTable.readAt} is not null)`.mapWith(Number),
        replied: sql<number>`count(*) filter (where ${textWhispsTable.status} = 'replied')`.mapWith(Number),
        deliveredInApp: sql<number>`count(*) filter (where ${textWhispsTable.recipientUserId} is not null)`.mapWith(Number),
        deliveredGuest: sql<number>`count(*) filter (where ${textWhispsTable.recipientUserId} is null)`.mapWith(Number),
      })
      .from(textWhispsTable)
      .then((r) => r[0]!),
  ]);

  res.json({
    funnel: funnelRow,
    deliveryByChannel: channelRows.map((r) => ({
      channel: r.channel,
      attempts: r.attempts,
      succeeded: r.succeeded,
      failed: r.attempts - r.succeeded,
      successRate: r.attempts ? Math.round((r.succeeded / r.attempts) * 1000) / 10 : 0,
    })),
    ghostBoost: {
      campaigns: ghostBoostRow.campaigns,
      totalMatched: ghostBoostRow.totalMatched,
      avgMatchedPerCampaign: ghostBoostRow.campaigns ? Math.round((ghostBoostRow.totalMatched / ghostBoostRow.campaigns) * 10) / 10 : 0,
    },
    circles: {
      totalCircles: circleCountRow?.count ?? 0,
      totalMembers: memberCountRow?.count ?? 0,
      totalDrops: dropsRow?.count ?? 0,
    },
    concierge: {
      totalRequests: conciergeRequestRow?.count ?? 0,
      requestsWithVideoMatch: conciergeMatchedRow?.count ?? 0,
      sends: conciergeSendsRow?.count ?? 0,
    },
    phoneMatchRouting: {
      inApp: phoneMatchRoutingRow.inApp,
      twilio: phoneMatchRoutingRow.twilio,
      matchRate:
        phoneMatchRoutingRow.inApp + phoneMatchRoutingRow.twilio > 0
          ? Math.round((phoneMatchRoutingRow.inApp / (phoneMatchRoutingRow.inApp + phoneMatchRoutingRow.twilio)) * 1000) / 10
          : 0,
    },
    invites: {
      sent: inviteRow.sent,
      joined: inviteRow.joined,
      conversionRate: inviteRow.sent ? Math.round((inviteRow.joined / inviteRow.sent) * 1000) / 10 : 0,
    },
    textWhisps: {
      sent: textWhispRow.sent,
      read: textWhispRow.read,
      replied: textWhispRow.replied,
      deliveredInApp: textWhispRow.deliveredInApp,
      deliveredGuest: textWhispRow.deliveredGuest,
    },
  });
});

// ---------------------------------------------------------------------------
// Notifications — admin-composed, persistent in-app notifications (distinct
// from the ephemeral, opt-in push in lib/push.ts). Sending one both writes
// the durable row(s) recipients can see in-app, and best-effort fires a live
// push to anyone with an active subscription — see routes/user.ts's
// GET /notifications for the recipient side.
// ---------------------------------------------------------------------------

const sendNotificationSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    body: z.string().trim().min(1).max(2000),
    // In-app path ("/whisps/abc") or absolute http(s) only — this renders as
    // a clickable href in every recipient's NotificationBell.
    url: z.string().min(1).max(2048).refine(isHttpUrlOrAppPath, { message: "Must be an app path or http(s) URL" }).nullable().optional(),
    audience: z.enum(["all", "users"]),
    userIds: z.array(z.string()).optional(),
    // Also deliver as a branded email to each recipient's inbox — the
    // channel that reaches people who aren't in the app. Respects each
    // user's emailNotificationsEnabled opt-out, and skips accounts whose
    // stored address is a fabricated placeholder (undeliverable — see
    // lib/ensureUser.ts).
    sendEmail: z.boolean().optional(),
  })
  .refine((data) => data.audience !== "users" || (data.userIds && data.userIds.length > 0), {
    message: "userIds is required and must be non-empty when audience is 'users'",
    path: ["userIds"],
  });

// POST /api/admin/notifications
router.post("/notifications", async (req, res): Promise<void> => {
  const parsed = sendNotificationSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const adminUser = (req as any).adminUser as User;
  const { title, body, audience } = parsed.data;
  const url = parsed.data.url ?? null;

  let targetUserIds: (string | null)[];
  if (audience === "all") {
    targetUserIds = [null];
  } else {
    // De-duplicate — sending to the same user id twice would just create two
    // identical rows they'd see twice in their notification list.
    targetUserIds = [...new Set(parsed.data.userIds!)];
  }

  await db.insert(notificationsTable).values(
    targetUserIds.map((targetUserId) => ({
      id: randomUUID(),
      targetUserId,
      title,
      body,
      url,
      createdByAdminId: adminUser.id,
    })),
  );

  const recipientCount = audience === "all" ? await db.select({ count: count() }).from(usersTable).then((r) => r[0]?.count ?? 0) : targetUserIds.length;

  // Best-effort live push alongside the durable in-app row — recipients
  // without an active push subscription still see it next time they open
  // the app, same as any other in-app notification.
  let pushDelivered = 0;
  if (audience === "all") {
    pushDelivered = await notifyAllUsers(title, body, url ?? undefined);
  } else {
    const perUserCounts = await Promise.all((targetUserIds as string[]).map((userId) => notifyUser(userId, title, body, url ?? "")));
    pushDelivered = perUserCounts.reduce((sum, n) => sum + n, 0);
  }

  // Optional email channel. Recipients are filtered to people email can
  // actually, appropriately reach: opted in (emailNotificationsEnabled),
  // not banned, and not carrying a fabricated placeholder address.
  let emailsSent = 0;
  let emailsSkipped = 0;
  if (parsed.data.sendEmail) {
    const recipients =
      audience === "all"
        ? await db.select().from(usersTable).where(eq(usersTable.banned, false))
        : await db.select().from(usersTable).where(inArray(usersTable.id, targetUserIds as string[]));
    const html = adminAnnouncementEmailHtml(title, body, url);
    for (const recipient of recipients) {
      if (!recipient.emailNotificationsEnabled || recipient.banned || isPlaceholderEmail(recipient.email, recipient.clerkId)) {
        emailsSkipped++;
        continue;
      }
      const ok = await sendEmail(recipient.email, title, html, { whispId: null, purpose: "admin_announcement" });
      if (ok) emailsSent++;
      else emailsSkipped++;
    }
  }

  logAdminAction(adminUser.id, "notification.send", { type: "notification", id: "batch" }, { audience, recipientCount, pushDelivered, emailsSent, emailsSkipped, emailed: !!parsed.data.sendEmail });

  res.status(201).json({ recipientCount, pushDelivered, emailsSent, emailsSkipped });
});

// GET /api/admin/notifications — audit log of everything sent, newest first.
router.get("/notifications", async (req, res): Promise<void> => {
  const { page, pageSize } = parsePagination(req);

  const [rows, totalRow] = await Promise.all([
    db
      .select()
      .from(notificationsTable)
      .orderBy(desc(notificationsTable.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ count: count() }).from(notificationsTable).then((r) => r[0]),
  ]);

  const userIds = [...new Set(rows.flatMap((n) => [n.targetUserId, n.createdByAdminId]).filter((id): id is string => !!id))];
  const users = userIds.length ? await db.select({ id: usersTable.id, email: usersTable.email }).from(usersTable).where(inArray(usersTable.id, userIds)) : [];
  const emailById = Object.fromEntries(users.map((u) => [u.id, u.email]));

  res.json({
    items: rows.map((n) => ({
      ...n,
      targetUserEmail: n.targetUserId ? (emailById[n.targetUserId] ?? null) : null,
      createdByAdminEmail: n.createdByAdminId ? (emailById[n.createdByAdminId] ?? null) : null,
    })),
    total: totalRow?.count ?? 0,
    page,
    pageSize,
  });
});

// POST /api/admin/users/repair-profiles — backfill for accounts stuck with
// a fabricated `${clerkId}@...` email (a signup-day Clerk fetch failure —
// see lib/ensureUser.ts). ensureUser self-heals such an account on that
// user's NEXT sign-in, but a dormant account never triggers that, so this
// sweeps every placeholder row against Clerk's API on demand. Per-row
// outcomes:
//   healed          — real email fetched and stored
//   noEmailInClerk  — Clerk has no email for them (e.g. phone-only signup);
//                     nothing to capture, placeholder stays
//   conflict        — Clerk's email is already on ANOTHER account (the
//                     same human signed up twice); left untouched rather
//                     than guessing which account should own it
router.post("/users/repair-profiles", async (req, res): Promise<void> => {
  const candidates = await db
    .select()
    .from(usersTable)
    .where(sql`${usersTable.email} LIKE ${usersTable.clerkId} || '@%'`)
    .limit(200);

  let healed = 0;
  let noEmailInClerk = 0;
  let conflicts = 0;
  for (const user of candidates) {
    // Belt and braces — the SQL LIKE above is the same predicate, but the
    // shared helper stays the single definition of "placeholder."
    if (!isPlaceholderEmail(user.email, user.clerkId)) continue;
    const profile = await fetchClerkProfile(user.clerkId);
    if (!profile.email) {
      noEmailInClerk++;
      continue;
    }
    try {
      await db
        .update(usersTable)
        .set({
          email: profile.email,
          ...(user.fullName ? {} : { fullName: profile.fullName }),
          ...(user.phone ? {} : { phone: profile.phone }),
        })
        .where(eq(usersTable.id, user.id));
      healed++;
    } catch {
      // users_email_unique — the real email already belongs to another row.
      conflicts++;
    }
  }

  const adminUser = (req as any).adminUser as User;
  logAdminAction(adminUser.id, "users.repair_profiles", { type: "user", id: "batch" }, { scanned: candidates.length, healed, noEmailInClerk, conflicts });

  res.json({ scanned: candidates.length, healed, noEmailInClerk, conflicts });
});

// ---------------------------------------------------------------------------
// Feature usage analytics — which buttons/features are actually used (and
// which aren't), plus the AI analyzer that turns the counters into
// practical trim/redesign recommendations. Capture side:
// routes/usageEvents.ts + lib/featureUsage.ts (frontend).
// ---------------------------------------------------------------------------

// GET /api/admin/usage-stats?days=30
router.get("/usage-stats", async (req, res): Promise<void> => {
  const days = Math.min(365, Math.max(1, parseInt(String(req.query.days ?? "30"), 10) || 30));
  const stats = await aggregateFeatureUsage(days);
  res.json({ items: stats, days });
});

// GET /api/admin/analytics/traffic-by-hour — 24-bucket UTC histogram of
// platform activity (summed feature_events.count, not row count — one row
// can represent many clicks, see that table's own comment), for the
// Analytics "when is the app actually used" chart. Same window param as
// usage-stats.
router.get("/analytics/traffic-by-hour", async (req, res): Promise<void> => {
  const days = Math.min(365, Math.max(1, parseInt(String(req.query.days ?? "30"), 10) || 30));
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const rows = await db
    .select({ hour: sql<number>`extract(hour from ${featureEventsTable.createdAt})`, total: sql<number>`sum(${featureEventsTable.count})` })
    .from(featureEventsTable)
    .where(gte(featureEventsTable.createdAt, since))
    .groupBy(sql`extract(hour from ${featureEventsTable.createdAt})`);

  const byHour = new Map(rows.map((r) => [Number(r.hour), Number(r.total)]));
  const hours = Array.from({ length: 24 }, (_, hour) => ({ hour, count: byHour.get(hour) ?? 0 }));
  const peak = hours.reduce((best, h) => (h.count > best.count ? h : best), hours[0]!);

  res.json({ hours, peakHour: peak.count > 0 ? peak.hour : null, days });
});

// POST /api/admin/usage-insights — the smart analyzer: aggregates the same
// window and asks Claude for practical, owner-actionable product insights.
router.post("/usage-insights", async (req, res): Promise<void> => {
  const days = Math.min(365, Math.max(1, parseInt(String((req.body ?? {}).days ?? "30"), 10) || 30));
  try {
    const result = await generateUsageInsights(days);
    const adminUser = (req as any).adminUser as User;
    logAdminAction(adminUser.id, "usage.analyze", { type: "analytics", id: "usage" }, { days, statsAnalyzed: result.statsAnalyzed });
    res.json({ ...result, days });
  } catch (err) {
    res.status(502).json({ error: "The analyzer couldn't complete — try again in a moment." });
  }
});

// ---------------------------------------------------------------------------
// Policy updates — the admin side of the re-consent system
// (policy_versions.ts): draft a "what changed" summary for the Privacy
// Policy or Terms, publish it, and from that moment every signed-in user is
// prompted to review and agree. The actual policy TEXT lives on the
// /privacy and /terms pages (updated in code); this tracks announcement +
// consent, not the prose.
// ---------------------------------------------------------------------------

// GET /api/admin/policy-versions — full history, newest first, with how
// many users have accepted each published version (vs. the total user
// count, for a progress read).
router.get("/policy-versions", async (_req, res): Promise<void> => {
  const [versions, acceptCounts, totalUsersRow] = await Promise.all([
    db.select().from(policyVersionsTable).orderBy(desc(policyVersionsTable.createdAt)),
    db
      .select({ policyVersionId: policyAcceptancesTable.policyVersionId, count: count() })
      .from(policyAcceptancesTable)
      .groupBy(policyAcceptancesTable.policyVersionId),
    db.select({ count: count() }).from(usersTable).then((r) => r[0]),
  ]);
  const countsById = Object.fromEntries(acceptCounts.map((c) => [c.policyVersionId, c.count]));
  res.json({
    items: versions.map((v) => ({ ...v, acceptedCount: countsById[v.id] ?? 0 })),
    totalUsers: totalUsersRow?.count ?? 0,
  });
});

const createPolicyVersionSchema = z.object({
  docType: z.enum(["privacy", "terms"]),
  summary: z.string().trim().min(1).max(1000),
});

// POST /api/admin/policy-versions — create a draft.
router.post("/policy-versions", async (req, res): Promise<void> => {
  const parsed = createPolicyVersionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const adminUser = (req as any).adminUser as User;
  const id = randomUUID();
  await db.insert(policyVersionsTable).values({
    id,
    docType: parsed.data.docType,
    summary: parsed.data.summary,
    publishedAt: null,
    createdByAdminId: adminUser.id,
  });
  logAdminAction(adminUser.id, "policy.draft", { type: "policy_version", id }, { docType: parsed.data.docType });
  const created = await db.select().from(policyVersionsTable).where(eq(policyVersionsTable.id, id)).then((r) => r[0]);
  res.status(201).json({ ...created, acceptedCount: 0 });
});

const updatePolicyVersionSchema = z.object({ summary: z.string().trim().min(1).max(1000) });

// PATCH /api/admin/policy-versions/:id — edit a DRAFT's summary. A
// published version is immutable: the consent record must stay exactly
// what users saw and agreed to.
router.patch("/policy-versions/:id", async (req, res): Promise<void> => {
  const version = await db.select().from(policyVersionsTable).where(eq(policyVersionsTable.id, req.params.id)).then((r) => r[0]);
  if (!version) {
    res.status(404).json({ error: "Policy update not found" });
    return;
  }
  if (version.publishedAt) {
    res.status(409).json({ error: "A published policy update can't be edited — create a new version instead." });
    return;
  }
  const parsed = updatePolicyVersionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  await db.update(policyVersionsTable).set({ summary: parsed.data.summary }).where(eq(policyVersionsTable.id, version.id));
  const updated = await db.select().from(policyVersionsTable).where(eq(policyVersionsTable.id, version.id)).then((r) => r[0]);
  res.json({ ...updated, acceptedCount: 0 });
});

// DELETE /api/admin/policy-versions/:id — discard a draft. Published
// versions are history and can't be deleted.
router.delete("/policy-versions/:id", async (req, res): Promise<void> => {
  const version = await db.select().from(policyVersionsTable).where(eq(policyVersionsTable.id, req.params.id)).then((r) => r[0]);
  if (!version) {
    res.status(404).json({ error: "Policy update not found" });
    return;
  }
  if (version.publishedAt) {
    res.status(409).json({ error: "A published policy update can't be deleted." });
    return;
  }
  await db.delete(policyVersionsTable).where(eq(policyVersionsTable.id, version.id));
  const adminUser = (req as any).adminUser as User;
  logAdminAction(adminUser.id, "policy.discard_draft", { type: "policy_version", id: version.id }, { docType: version.docType });
  res.status(204).send();
});

// POST /api/admin/policy-versions/:id/publish — the moment the prompt goes
// live for every signed-in user (in-app, on refresh, or at next login —
// however they arrive next, PolicyUpdateGate picks it up).
router.post("/policy-versions/:id/publish", async (req, res): Promise<void> => {
  const version = await db.select().from(policyVersionsTable).where(eq(policyVersionsTable.id, req.params.id)).then((r) => r[0]);
  if (!version) {
    res.status(404).json({ error: "Policy update not found" });
    return;
  }
  if (version.publishedAt) {
    res.status(409).json({ error: "This policy update is already published." });
    return;
  }
  await db.update(policyVersionsTable).set({ publishedAt: new Date() }).where(eq(policyVersionsTable.id, version.id));
  const adminUser = (req as any).adminUser as User;
  logAdminAction(adminUser.id, "policy.publish", { type: "policy_version", id: version.id }, { docType: version.docType });
  const updated = await db.select().from(policyVersionsTable).where(eq(policyVersionsTable.id, version.id)).then((r) => r[0]);
  res.json({ ...updated, acceptedCount: 0 });
});

// ---------------------------------------------------------------------------
// Moderation — the content-safety flag queue lib/moderation.ts's classifier
// writes to. A flag is a "worth a human look" signal, not a verdict:
// dismissing one records that an admin looked and decided it's a false
// positive; leaving it as-is is itself the record. Nothing here ever bans
// or suspends anyone — that stays a deliberate action via PATCH
// /users/:id's existing `banned` field.
// ---------------------------------------------------------------------------

// GET /api/admin/moderation/flags
router.get("/moderation/flags", async (req, res): Promise<void> => {
  const { page, pageSize } = parsePagination(req);
  const dismissedFilter = req.query.dismissed === "true" ? true : req.query.dismissed === "false" ? false : undefined;
  const severityFilter = typeof req.query.severity === "string" ? req.query.severity : undefined;

  const conditions = [];
  if (dismissedFilter !== undefined) conditions.push(eq(moderationFlagsTable.dismissed, dismissedFilter));
  if (severityFilter) conditions.push(eq(moderationFlagsTable.severity, severityFilter));
  const where = conditions.length ? and(...conditions) : undefined;

  const [rows, totalRow] = await Promise.all([
    db
      .select({
        id: moderationFlagsTable.id,
        whispId: moderationFlagsTable.whispId,
        textWhispId: moderationFlagsTable.textWhispId,
        debateTopicId: moderationFlagsTable.debateTopicId,
        debateTopicCommentId: moderationFlagsTable.debateTopicCommentId,
        whisperBoxMessageId: moderationFlagsTable.whisperBoxMessageId,
        contentType: moderationFlagsTable.contentType,
        userId: moderationFlagsTable.userId,
        severity: moderationFlagsTable.severity,
        reasoning: moderationFlagsTable.reasoning,
        source: moderationFlagsTable.source,
        dismissed: moderationFlagsTable.dismissed,
        reviewedAt: moderationFlagsTable.reviewedAt,
        reviewedByAdminId: moderationFlagsTable.reviewedByAdminId,
        createdAt: moderationFlagsTable.createdAt,
        videoTitle: whispsTable.videoTitle,
        textWhispMessage: textWhispsTable.messageText,
        circleCommentText: circleCommentsTable.commentText,
        debateTopicText: debateTopicsTable.topicText,
        debateTopicCommentText: debateTopicCommentsTable.commentText,
        whisperBoxMessageText: whisperBoxMessagesTable.messageText,
        senderEmail: usersTable.email,
      })
      .from(moderationFlagsTable)
      // leftJoin, not innerJoin — a flag row only ever matches one of
      // whispsTable/textWhispsTable/circleCommentsTable/debateTopicsTable/
      // debateTopicCommentsTable/whisperBoxMessagesTable, per contentType.
      // usersTable is also a leftJoin, not inner: a circle_comment,
      // debate_topic_comment, or whisper_box_message flag has no account to
      // attribute it to (userId=null) and should still show up here, just
      // without a "Sender:" link to follow.
      .leftJoin(whispsTable, eq(moderationFlagsTable.whispId, whispsTable.id))
      .leftJoin(textWhispsTable, eq(moderationFlagsTable.textWhispId, textWhispsTable.id))
      .leftJoin(circleCommentsTable, eq(moderationFlagsTable.circleCommentId, circleCommentsTable.id))
      .leftJoin(debateTopicsTable, eq(moderationFlagsTable.debateTopicId, debateTopicsTable.id))
      .leftJoin(debateTopicCommentsTable, eq(moderationFlagsTable.debateTopicCommentId, debateTopicCommentsTable.id))
      .leftJoin(whisperBoxMessagesTable, eq(moderationFlagsTable.whisperBoxMessageId, whisperBoxMessagesTable.id))
      .leftJoin(usersTable, eq(moderationFlagsTable.userId, usersTable.id))
      .where(where)
      .orderBy(desc(moderationFlagsTable.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ count: count() }).from(moderationFlagsTable).where(where).then((r) => r[0]),
  ]);

  res.json({ items: rows, total: totalRow?.count ?? 0, page, pageSize });
});

const updateModerationFlagSchema = z.object({ dismissed: z.boolean() });

// PATCH /api/admin/moderation/flags/:id
router.patch("/moderation/flags/:id", async (req, res): Promise<void> => {
  const existing = await db.select().from(moderationFlagsTable).where(eq(moderationFlagsTable.id, req.params.id)).then((r) => r[0]);
  if (!existing) {
    res.status(404).json({ error: "Flag not found" });
    return;
  }

  const parsed = updateModerationFlagSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const adminUser = (req as any).adminUser as User;
  await db
    .update(moderationFlagsTable)
    .set({ dismissed: parsed.data.dismissed, reviewedAt: new Date(), reviewedByAdminId: adminUser.id })
    .where(eq(moderationFlagsTable.id, existing.id));

  logAdminAction(adminUser.id, "moderation.flag_review", { type: "moderation_flag", id: existing.id }, { dismissed: parsed.data.dismissed, contentType: existing.contentType });

  const updated = await db.select().from(moderationFlagsTable).where(eq(moderationFlagsTable.id, existing.id)).then((r) => r[0]);
  res.json(updated);
});

// POST /api/admin/moderation/flags/:id/remove-content — the real takedown
// action this queue exists to lead to: PATCH above only ever dismisses or
// leaves a flag as-is, neither of which touches the underlying content.
// This pulls it from every public read path by setting removedByAdminAt on
// whichever table the flag's contentType points at, distinct from
// deletedByAuthorAt/deletedBySenderAt (the author's/sender's own choice) for
// the accountability reasons each of those columns' comments describe.
router.post("/moderation/flags/:id/remove-content", async (req, res): Promise<void> => {
  const flag = await db.select().from(moderationFlagsTable).where(eq(moderationFlagsTable.id, req.params.id)).then((r) => r[0]);
  if (!flag) {
    res.status(404).json({ error: "Flag not found" });
    return;
  }

  const now = new Date();
  switch (flag.contentType) {
    case "whisp":
      if (!flag.whispId) { res.status(400).json({ error: "Flag has no associated whisp" }); return; }
      await db.update(whispsTable).set({ removedByAdminAt: now }).where(eq(whispsTable.id, flag.whispId));
      break;
    case "circle_comment":
      if (!flag.circleCommentId) { res.status(400).json({ error: "Flag has no associated comment" }); return; }
      await db.update(circleCommentsTable).set({ removedByAdminAt: now }).where(eq(circleCommentsTable.id, flag.circleCommentId));
      break;
    case "debate_topic":
      if (!flag.debateTopicId) { res.status(400).json({ error: "Flag has no associated topic" }); return; }
      await db.update(debateTopicsTable).set({ removedByAdminAt: now }).where(eq(debateTopicsTable.id, flag.debateTopicId));
      break;
    case "debate_topic_comment":
      if (!flag.debateTopicCommentId) { res.status(400).json({ error: "Flag has no associated comment" }); return; }
      await db.update(debateTopicCommentsTable).set({ removedByAdminAt: now }).where(eq(debateTopicCommentsTable.id, flag.debateTopicCommentId));
      break;
    case "whisper_box_message":
      if (!flag.whisperBoxMessageId) { res.status(400).json({ error: "Flag has no associated message" }); return; }
      await db.update(whisperBoxMessagesTable).set({ removedByAdminAt: now }).where(eq(whisperBoxMessagesTable.id, flag.whisperBoxMessageId));
      break;
    default:
      res.status(400).json({ error: "This content type can't be taken down from here" });
      return;
  }

  const adminUser = (req as any).adminUser as User;
  await db
    .update(moderationFlagsTable)
    .set({ dismissed: false, reviewedAt: now, reviewedByAdminId: adminUser.id })
    .where(eq(moderationFlagsTable.id, flag.id));

  logAdminAction(adminUser.id, "content.remove", { type: flag.contentType, id: flag.whispId ?? flag.circleCommentId ?? flag.debateTopicId ?? flag.debateTopicCommentId ?? flag.id }, { flagId: flag.id });

  const updated = await db.select().from(moderationFlagsTable).where(eq(moderationFlagsTable.id, flag.id)).then((r) => r[0]);
  res.json(updated);
});

// ---------------------------------------------------------------------------
// Community reports — the user-filed queue (content_reports.ts), distinct
// from the automated moderation_flags queue above. Reports arrive
// pre-categorized (reason → stored priority, see routes/contentReports.ts's
// REASON_PRIORITY) and this queue orders itself by that priority so the
// worst things surface first; an admin can re-triage, take a report into
// review, keep working notes, and finally resolve it — which is also the
// moment the reporter hears back and (optionally) the author gets warned.
// ---------------------------------------------------------------------------

// Sorts critical → high → medium → low; anything unexpected sinks to the
// bottom rather than breaking the queue.
const reportPriorityRank = sql`CASE ${contentReportsTable.priority} WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4 END`;

const REPORT_PRIORITIES = ["critical", "high", "medium", "low"] as const;

// GET /api/admin/content-reports
router.get("/content-reports", async (req, res): Promise<void> => {
  const { page, pageSize } = parsePagination(req);
  const statusFilter = typeof req.query.status === "string" ? req.query.status : "unresolved";
  const priorityFilter = typeof req.query.priority === "string" ? req.query.priority : undefined;
  const reasonFilter = typeof req.query.reason === "string" ? req.query.reason : undefined;

  const conditions = [];
  // "unresolved" (the default view) is the working queue: open + in_review.
  if (statusFilter === "unresolved") conditions.push(inArray(contentReportsTable.status, ["open", "in_review"]));
  else if (statusFilter !== "all") conditions.push(eq(contentReportsTable.status, statusFilter));
  if (priorityFilter) conditions.push(eq(contentReportsTable.priority, priorityFilter));
  if (reasonFilter) conditions.push(eq(contentReportsTable.reason, reasonFilter));
  const where = conditions.length ? and(...conditions) : undefined;

  const [rows, totalRow, summaryRows] = await Promise.all([
    db
      .select({
        id: contentReportsTable.id,
        contentType: contentReportsTable.contentType,
        debateTopicId: contentReportsTable.debateTopicId,
        debateTopicCommentId: contentReportsTable.debateTopicCommentId,
        reporterUserId: contentReportsTable.reporterUserId,
        reason: contentReportsTable.reason,
        detail: contentReportsTable.detail,
        priority: contentReportsTable.priority,
        status: contentReportsTable.status,
        resolution: contentReportsTable.resolution,
        adminNotes: contentReportsTable.adminNotes,
        adminReplyMessage: contentReportsTable.adminReplyMessage,
        authorWarnedAt: contentReportsTable.authorWarnedAt,
        resolvedAt: contentReportsTable.resolvedAt,
        createdAt: contentReportsTable.createdAt,
        reporterEmail: usersTable.email,
        debateTopicText: debateTopicsTable.topicText,
        debateTopicAuthorId: debateTopicsTable.authorId,
        topicRemovedByAdminAt: debateTopicsTable.removedByAdminAt,
        topicDeletedByAuthorAt: debateTopicsTable.deletedByAuthorAt,
        debateTopicCommentText: debateTopicCommentsTable.commentText,
        commentAuthorUserId: debateTopicCommentsTable.authorUserId,
        commentRemovedByAdminAt: debateTopicCommentsTable.removedByAdminAt,
      })
      .from(contentReportsTable)
      .leftJoin(usersTable, eq(contentReportsTable.reporterUserId, usersTable.id))
      .leftJoin(debateTopicsTable, eq(contentReportsTable.debateTopicId, debateTopicsTable.id))
      .leftJoin(debateTopicCommentsTable, eq(contentReportsTable.debateTopicCommentId, debateTopicCommentsTable.id))
      .where(where)
      // Priority first (critical work surfaces regardless of arrival
      // order), oldest first within a priority — the report that's waited
      // longest at the same severity gets looked at next, plain FIFO.
      .orderBy(reportPriorityRank, asc(contentReportsTable.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ count: count() }).from(contentReportsTable).where(where).then((r) => r[0]),
    // The triage summary deliberately IGNORES the current filter: its
    // whole job is "what's still waiting, at what severity," which should
    // stay visible (and alarming, when critical > 0) even while the admin
    // is browsing resolved history.
    db
      .select({ priority: contentReportsTable.priority, count: count() })
      .from(contentReportsTable)
      .where(inArray(contentReportsTable.status, ["open", "in_review"]))
      .groupBy(contentReportsTable.priority),
  ]);

  const openByPriority: Record<string, number> = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const row of summaryRows) {
    if (row.priority in openByPriority) openByPriority[row.priority] = row.count;
  }

  res.json({ items: rows, total: totalRow?.count ?? 0, page, pageSize, openByPriority });
});

const updateContentReportSchema = z.object({
  priority: z.enum(REPORT_PRIORITIES).optional(),
  // Only the two working states are settable here — "resolved" is reachable
  // exclusively through POST /:id/resolve below, which is what enforces the
  // notify-the-reporter step a resolution is supposed to carry.
  status: z.enum(["open", "in_review"]).optional(),
  adminNotes: z.string().max(2000).nullable().optional(),
});

// PATCH /api/admin/content-reports/:id — the review/triage tool: re-rank a
// report's priority, claim it into review, keep working notes.
router.patch("/content-reports/:id", async (req, res): Promise<void> => {
  const report = await db.select().from(contentReportsTable).where(eq(contentReportsTable.id, req.params.id)).then((r) => r[0]);
  if (!report) {
    res.status(404).json({ error: "Report not found" });
    return;
  }
  if (report.status === "resolved") {
    res.status(409).json({ error: "This report is already resolved." });
    return;
  }

  const parsed = updateContentReportSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const updates: Record<string, unknown> = {};
  if (parsed.data.priority !== undefined) updates.priority = parsed.data.priority;
  if (parsed.data.status !== undefined) updates.status = parsed.data.status;
  if (parsed.data.adminNotes !== undefined) updates.adminNotes = parsed.data.adminNotes;
  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: "Nothing to update" });
    return;
  }

  await db.update(contentReportsTable).set(updates).where(eq(contentReportsTable.id, report.id));

  const adminUser = (req as any).adminUser as User;
  logAdminAction(adminUser.id, "report.update", { type: "content_report", id: report.id }, { before: { priority: report.priority, status: report.status }, after: parsed.data });

  const updated = await db.select().from(contentReportsTable).where(eq(contentReportsTable.id, report.id)).then((r) => r[0]);
  res.json(updated);
});

const resolveContentReportSchema = z.object({
  resolution: z.enum(["removed", "no_violation"]),
  // Optional custom message to the reporter — when omitted, a default
  // template for the chosen resolution is sent instead. The reporter ALWAYS
  // hears back; what's optional is only whether an admin personalizes it.
  replyToReporter: z.string().trim().max(1000).optional(),
  // When present, the content's author receives this as a Community
  // Guidelines warning notification. Only possible when the author has an
  // account — see the authorWarned flag in the response.
  warnAuthor: z.string().trim().max(1000).optional(),
});

// POST /api/admin/content-reports/:id/resolve — closes the loop the report
// opened: optionally takes the content down, always tells the reporter what
// happened, optionally warns the author.
router.post("/content-reports/:id/resolve", async (req, res): Promise<void> => {
  const report = await db.select().from(contentReportsTable).where(eq(contentReportsTable.id, req.params.id)).then((r) => r[0]);
  if (!report) {
    res.status(404).json({ error: "Report not found" });
    return;
  }
  if (report.status === "resolved") {
    res.status(409).json({ error: "This report is already resolved." });
    return;
  }

  const parsed = resolveContentReportSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { resolution } = parsed.data;
  const replyToReporter = parsed.data.replyToReporter?.trim() || null;
  const warnAuthor = parsed.data.warnAuthor?.trim() || null;

  const now = new Date();

  // Resolve the content row + its author's account id (null = anonymous
  // no-account commenter, who can't be warned).
  let authorUserId: string | null = null;
  if (report.contentType === "debate_topic" && report.debateTopicId) {
    const topic = await db.select().from(debateTopicsTable).where(eq(debateTopicsTable.id, report.debateTopicId)).then((r) => r[0]);
    authorUserId = topic?.authorId ?? null;
    if (resolution === "removed" && topic && !topic.removedByAdminAt) {
      await db.update(debateTopicsTable).set({ removedByAdminAt: now }).where(eq(debateTopicsTable.id, topic.id));
    }
  } else if (report.contentType === "debate_topic_comment" && report.debateTopicCommentId) {
    const comment = await db.select().from(debateTopicCommentsTable).where(eq(debateTopicCommentsTable.id, report.debateTopicCommentId)).then((r) => r[0]);
    authorUserId = comment?.authorUserId ?? null;
    if (resolution === "removed" && comment && !comment.removedByAdminAt) {
      await db.update(debateTopicCommentsTable).set({ removedByAdminAt: now }).where(eq(debateTopicCommentsTable.id, comment.id));
    }
  }

  // The reporter always hears the outcome — a custom reply when the admin
  // wrote one, an honest default otherwise. Silence is the one thing this
  // endpoint refuses to do with a resolution.
  const reporterBody =
    replyToReporter ??
    (resolution === "removed"
      ? "Thanks for your report. We reviewed the content and removed it for violating our Community Guidelines."
      : "Thanks for your report. We reviewed the content and found it doesn't violate our Community Guidelines, so it will stay up. We appreciate you looking out for the community.");
  await notifyUserPersisted(report.reporterUserId, "Update on your report", reporterBody, "/community-guidelines", "report_update");

  let authorWarned = false;
  if (warnAuthor) {
    if (authorUserId) {
      await notifyUserPersisted(
        authorUserId,
        "Community Guidelines warning",
        `${warnAuthor}\n\nPlease review our Community Guidelines. Repeated violations may result in account suspension.`,
        "/community-guidelines",
        "moderation_warning",
      );
      authorWarned = true;
    }
    // else: anonymous no-account author — nowhere to deliver a warning, so
    // it's skipped; authorWarned:false in the response tells the admin so.
  }

  await db
    .update(contentReportsTable)
    .set({
      status: "resolved",
      resolution,
      adminReplyMessage: reporterBody,
      authorWarnedAt: authorWarned ? now : null,
      resolvedAt: now,
      resolvedByAdminId: ((req as any).adminUser as User).id,
    })
    .where(eq(contentReportsTable.id, report.id));

  const adminUser = (req as any).adminUser as User;
  logAdminAction(
    adminUser.id,
    "report.resolve",
    { type: "content_report", id: report.id },
    { resolution, contentType: report.contentType, contentId: report.debateTopicId ?? report.debateTopicCommentId, authorWarned, repliedWithCustomMessage: !!replyToReporter },
  );

  const updated = await db.select().from(contentReportsTable).where(eq(contentReportsTable.id, report.id)).then((r) => r[0]);
  res.json({ ...updated, authorWarned });
});

// ---------------------------------------------------------------------------
// Suggestions Library
// ---------------------------------------------------------------------------

const VALID_SUGGESTION_CATEGORY_KEYS = new Set<string>(VIDEO_CATEGORIES.map((c) => c.key));

const createSuggestionSchema = z.object({
  // Not plain .url(): "javascript:alert(1)" passes z.string().url() — the
  // http(s)-protocol check is what actually matters for the href sink.
  videoUrl: httpUrlString,
  categories: z
    .array(z.string())
    .min(1)
    .max(5)
    .refine((cats) => cats.every((c) => VALID_SUGGESTION_CATEGORY_KEYS.has(c)), { message: "Invalid category" }),
  featured: z.boolean().optional(),
});

const updateSuggestionSchema = z.object({
  categories: z
    .array(z.string())
    .min(1)
    .max(5)
    .refine((cats) => cats.every((c) => VALID_SUGGESTION_CATEGORY_KEYS.has(c)), { message: "Invalid category" })
    .optional(),
  featured: z.boolean().optional(),
  status: z.enum(["pending", "published", "archived"]).optional(),
  aiSummary: z.string().max(200).nullable().optional(),
});

// POST /api/admin/suggestions — admin manually adds a video to the library.
router.post("/suggestions", async (req, res): Promise<void> => {
  const parsed = createSuggestionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const outcome = await resolveVideoMeta(parsed.data.videoUrl);
  switch (outcome.kind) {
    case "invalid_url":
      res.status(400).json({ error: "Only http/https URLs are supported" });
      return;
    case "unsupported":
      res.status(400).json({ error: "Unsupported video URL. Only YouTube, TikTok, Instagram, Facebook, Vimeo, and X/Twitter links are supported." });
      return;
    case "blocked":
      res.status(422).json({ error: outcome.error, code: outcome.code });
      return;
    // Unlike a sender's one-off whisp (routes/video.ts), a Suggestions
    // Library entry is a public, curated gallery card — there's no manual
    // title/thumbnail override in this endpoint's schema to fall back to,
    // and publishing one with no title/thumbnail would just look broken in
    // the gallery. Reject rather than silently create a blank-looking entry.
    case "no_preview":
      res.status(422).json({
        error: `Couldn't generate a preview for this ${outcome.platform} link, so it can't be added to the library this way.`,
        code: "video_private",
      });
      return;
  }

  const adminUser = (req as any).adminUser as User;
  const id = randomUUID();
  const now = new Date();

  await db.insert(suggestedVideosTable).values({
    id,
    videoUrl: parsed.data.videoUrl,
    videoTitle: outcome.title,
    videoThumbnail: outcome.thumbnail,
    videoEmbedUrl: outcome.embedUrl,
    videoPlatform: outcome.platform,
    authorName: outcome.authorName,
    categories: parsed.data.categories,
    featured: parsed.data.featured ?? false,
    status: "published",
    source: "admin",
    addedByUserId: adminUser.id,
    publishedAt: now,
  });

  void generateSuggestionSummaryAsync(id);

  const created = await db.select().from(suggestedVideosTable).where(eq(suggestedVideosTable.id, id)).then((r) => r[0]);
  res.status(201).json(created);
});

// GET /api/admin/suggestions
router.get("/suggestions", async (req, res): Promise<void> => {
  const { page, pageSize } = parsePagination(req);
  const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
  const statusFilter = typeof req.query.status === "string" ? req.query.status : undefined;
  const sourceFilter = typeof req.query.source === "string" ? req.query.source : undefined;
  const categoryFilter = typeof req.query.category === "string" ? req.query.category : undefined;
  const featuredFilter = req.query.featured === "true" ? true : req.query.featured === "false" ? false : undefined;

  const conditions = [];
  if (search) conditions.push(ilike(suggestedVideosTable.videoTitle, `%${search}%`));
  if (statusFilter) conditions.push(eq(suggestedVideosTable.status, statusFilter));
  if (sourceFilter) conditions.push(eq(suggestedVideosTable.source, sourceFilter));
  if (featuredFilter !== undefined) conditions.push(eq(suggestedVideosTable.featured, featuredFilter));
  if (categoryFilter) conditions.push(sql`${categoryFilter} = ANY(${suggestedVideosTable.categories})`);
  const where = conditions.length ? and(...conditions) : undefined;

  const [items, totalRow] = await Promise.all([
    db.select().from(suggestedVideosTable).where(where).orderBy(desc(suggestedVideosTable.createdAt)).limit(pageSize).offset((page - 1) * pageSize),
    db.select({ count: count() }).from(suggestedVideosTable).where(where).then((r) => r[0]),
  ]);

  res.json({ items, total: totalRow?.count ?? 0, page, pageSize });
});

// GET /api/admin/suggestions/agent-status — surfaces the AI discovery
// agent's last run outcome, most importantly whether it looks like it
// stopped working because the Anthropic account ran out of credit (the one
// failure mode that needs a human to actually do something, versus a
// transient error the next scheduled run will just retry past). Registered
// before the /suggestions/:id route below so "agent-status" is never
// swallowed as a suggestion id.
router.get("/suggestions/agent-status", async (_req, res): Promise<void> => {
  const status = await db
    .select()
    .from(suggestionAgentStatusTable)
    .where(eq(suggestionAgentStatusTable.id, "singleton"))
    .then((r) => r[0]);

  res.json(
    status ?? {
      id: "singleton",
      lastRunAt: null,
      lastRunOk: true,
      lastErrorMessage: null,
      lowCreditSuspected: false,
      consecutiveFailures: 0,
    },
  );
});

// POST /api/admin/suggestions/run-agent — triggers a discovery sweep
// immediately instead of waiting for the next scheduled run (once a day),
// so an admin can verify the agent is working (or see exactly why it
// isn't) right after setting it up.
router.post("/suggestions/run-agent", async (_req, res): Promise<void> => {
  const result = await runSuggestionDiscoveryAgent();
  const status = await db
    .select()
    .from(suggestionAgentStatusTable)
    .where(eq(suggestionAgentStatusTable.id, "singleton"))
    .then((r) => r[0]);

  res.json({ ...result, status: status ?? null });
});

// GET /api/admin/suggestions/:id
router.get("/suggestions/:id", async (req, res): Promise<void> => {
  const suggestion = await db.select().from(suggestedVideosTable).where(eq(suggestedVideosTable.id, req.params.id)).then((r) => r[0]);
  if (!suggestion) {
    res.status(404).json({ error: "Suggestion not found" });
    return;
  }
  res.json(suggestion);
});

// PATCH /api/admin/suggestions/:id — approve/edit/archive. Approving an
// AI-agent-discovered suggestion is just a status transition to "published";
// a manual aiSummary override marks the status "ready" so the background
// generator won't clobber it (the atomic-claim UPDATE only fires when
// aiSummaryStatus is still null).
router.patch("/suggestions/:id", async (req, res): Promise<void> => {
  const existing = await db.select().from(suggestedVideosTable).where(eq(suggestedVideosTable.id, req.params.id)).then((r) => r[0]);
  if (!existing) {
    res.status(404).json({ error: "Suggestion not found" });
    return;
  }

  const parsed = updateSuggestionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { aiSummary, ...rest } = parsed.data;
  const updates: Partial<typeof suggestedVideosTable.$inferInsert> = { ...rest };
  if (aiSummary !== undefined) {
    updates.aiSummary = aiSummary;
    updates.aiSummaryStatus = aiSummary === null ? null : "ready";
  }
  if (rest.status === "published" && existing.status !== "published") {
    updates.publishedAt = new Date();
  }

  await db.update(suggestedVideosTable).set(updates).where(eq(suggestedVideosTable.id, existing.id));
  const updated = await db.select().from(suggestedVideosTable).where(eq(suggestedVideosTable.id, existing.id)).then((r) => r[0]);
  res.json(updated);
});

// DELETE /api/admin/suggestions/:id
router.delete("/suggestions/:id", async (req, res): Promise<void> => {
  const existing = await db.select().from(suggestedVideosTable).where(eq(suggestedVideosTable.id, req.params.id)).then((r) => r[0]);
  if (!existing) {
    res.status(404).json({ error: "Suggestion not found" });
    return;
  }

  await db.delete(suggestedVideosTable).where(eq(suggestedVideosTable.id, existing.id));
  res.status(204).send();
});

// ---------------------------------------------------------------------------
// Audit log
// ---------------------------------------------------------------------------

// GET /api/admin/audit-log — the admin-accountability trail (lib/adminAudit.ts):
// who did what sensitive action, to what, and when. Optionally filtered to
// one admin or one target type.
router.get("/audit-log", async (req, res): Promise<void> => {
  const { page, pageSize } = parsePagination(req);
  const adminUserId = typeof req.query.adminUserId === "string" ? req.query.adminUserId : undefined;
  const targetType = typeof req.query.targetType === "string" ? req.query.targetType : undefined;

  const items = await listAdminAuditLog({ page, pageSize, adminUserId, targetType });
  res.json({ items, page, pageSize });
});

export default router;
