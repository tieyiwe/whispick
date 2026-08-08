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
  type User,
} from "@workspace/db";
import { and, asc, count, desc, eq, gte, ilike, inArray, isNotNull, isNull, ne, or, sql } from "drizzle-orm";
import { requireAdmin } from "../lib/adminAuth";
import { VIDEO_CATEGORIES } from "../lib/categorize";
import { computeOpportunities } from "../lib/insights";
import { resolveVideoMeta } from "../lib/videoMeta";
import { generateSuggestionSummaryAsync } from "../lib/suggestionSummary";
import { runSuggestionDiscoveryAgent } from "../lib/suggestionAgent";
import { notifyUser, notifyAllUsers } from "../lib/push";

const router = Router();

router.use(requireAdmin);

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
router.get("/users", async (req, res): Promise<void> => {
  const { page, pageSize } = parsePagination(req);
  const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
  const planFilter = typeof req.query.plan === "string" ? req.query.plan : undefined;
  const roleFilter = typeof req.query.role === "string" ? req.query.role : undefined;
  const bannedFilter = req.query.banned === "true" ? true : req.query.banned === "false" ? false : undefined;

  const conditions = [];
  if (search) conditions.push(or(ilike(usersTable.email, `%${search}%`), ilike(usersTable.fullName, `%${search}%`)));
  if (planFilter) conditions.push(eq(usersTable.plan, planFilter));
  if (roleFilter) conditions.push(eq(usersTable.role, roleFilter));
  if (bannedFilter !== undefined) conditions.push(eq(usersTable.banned, bannedFilter));
  const where = conditions.length ? and(...conditions) : undefined;

  const [items, totalRow] = await Promise.all([
    db.select().from(usersTable).where(where).orderBy(desc(usersTable.createdAt)).limit(pageSize).offset((page - 1) * pageSize),
    db.select({ count: count() }).from(usersTable).where(where).then((r) => r[0]),
  ]);

  res.json({ items, total: totalRow?.count ?? 0, page, pageSize });
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

  const [recentWhisps, totalWhispsRow, creditTransactions, statusRows, totalRepliesRow, moderationFlagRows] = await Promise.all([
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
    // Every content-safety flag on this user's whisps AND text whisps,
    // dismissed or not — an admin reviewing one flag can see this person's
    // full flag history right here instead of hunting for it in the
    // site-wide queue. leftJoin (not innerJoin) on both content tables since
    // a flag row only ever has one of whispId/textWhispId set (see
    // moderation_flags.ts's contentType) — an innerJoin on either alone
    // would silently drop the other content type's flags.
    db
      .select({
        id: moderationFlagsTable.id,
        whispId: moderationFlagsTable.whispId,
        textWhispId: moderationFlagsTable.textWhispId,
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
      })
      .from(moderationFlagsTable)
      .leftJoin(whispsTable, eq(moderationFlagsTable.whispId, whispsTable.id))
      .leftJoin(textWhispsTable, eq(moderationFlagsTable.textWhispId, textWhispsTable.id))
      .where(eq(moderationFlagsTable.userId, user.id))
      .orderBy(desc(moderationFlagsTable.createdAt)),
  ]);

  res.json({
    user,
    recentWhisps,
    totalWhisps: totalWhispsRow?.count ?? 0,
    creditTransactions,
    statusCounts: Object.fromEntries(statusRows.map((r) => [r.status, r.count])),
    totalReplies: totalRepliesRow?.count ?? 0,
    moderationFlagCount: moderationFlagRows.filter((f) => !f.dismissed).length,
    moderationFlags: moderationFlagRows,
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

  await db.update(usersTable).set(parsed.data).where(eq(usersTable.id, target.id));
  const updated = await db.select().from(usersTable).where(eq(usersTable.id, target.id)).then((r) => r[0]);
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
    // volume and how far it gets read/replied, same lightweight treatment.
    db
      .select({
        sent: count(),
        read: sql<number>`count(*) filter (where ${textWhispsTable.readAt} is not null)`.mapWith(Number),
        replied: sql<number>`count(*) filter (where ${textWhispsTable.status} = 'replied')`.mapWith(Number),
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
    url: z.string().min(1).nullable().optional(),
    audience: z.enum(["all", "users"]),
    userIds: z.array(z.string()).optional(),
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

  res.status(201).json({ recipientCount, pushDelivered });
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
        senderEmail: usersTable.email,
      })
      .from(moderationFlagsTable)
      // leftJoin, not innerJoin — see the same comment on the
      // /users/:id moderationFlags query above: a flag row only ever
      // matches one of whispsTable/textWhispsTable.
      .leftJoin(whispsTable, eq(moderationFlagsTable.whispId, whispsTable.id))
      .leftJoin(textWhispsTable, eq(moderationFlagsTable.textWhispId, textWhispsTable.id))
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

  const updated = await db.select().from(moderationFlagsTable).where(eq(moderationFlagsTable.id, existing.id)).then((r) => r[0]);
  res.json(updated);
});

// ---------------------------------------------------------------------------
// Suggestions Library
// ---------------------------------------------------------------------------

const VALID_SUGGESTION_CATEGORY_KEYS = new Set<string>(VIDEO_CATEGORIES.map((c) => c.key));

const createSuggestionSchema = z.object({
  videoUrl: z.string().url(),
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

export default router;
