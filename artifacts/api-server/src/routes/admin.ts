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
  type User,
} from "@workspace/db";
import { and, asc, count, desc, eq, gte, ilike, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import { requireAdmin } from "../lib/adminAuth";
import { VIDEO_CATEGORIES } from "../lib/categorize";
import { computeOpportunities } from "../lib/insights";
import { resolveVideoMeta } from "../lib/videoMeta";
import { generateSuggestionSummaryAsync } from "../lib/suggestionSummary";
import { runSuggestionDiscoveryAgent } from "../lib/suggestionAgent";

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

// GET /api/admin/users/:id
router.get("/users/:id", async (req, res): Promise<void> => {
  const user = await db.select().from(usersTable).where(eq(usersTable.id, req.params.id)).then((r) => r[0]);
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  const [recentWhisps, totalWhispsRow, creditTransactions] = await Promise.all([
    db.select().from(whispsTable).where(eq(whispsTable.senderId, user.id)).orderBy(desc(whispsTable.createdAt)).limit(50),
    db.select({ count: count() }).from(whispsTable).where(eq(whispsTable.senderId, user.id)).then((r) => r[0]),
    db.select().from(creditTransactionsTable).where(eq(creditTransactionsTable.userId, user.id)).orderBy(desc(creditTransactionsTable.createdAt)).limit(50),
  ]);

  res.json({ user, recentWhisps, totalWhisps: totalWhispsRow?.count ?? 0, creditTransactions });
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
  const statusFilter = typeof req.query.status === "string" ? req.query.status : undefined;
  const deliveryFilter = typeof req.query.deliveryMethod === "string" ? req.query.deliveryMethod : undefined;
  const categoryFilter = typeof req.query.category === "string" ? req.query.category : undefined;

  const conditions = [];
  if (search) conditions.push(ilike(whispsTable.videoTitle, `%${search}%`));
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

  const senderIds = [...new Set(items.map((w) => w.senderId))];
  const senders = senderIds.length
    ? await db.select({ id: usersTable.id, email: usersTable.email }).from(usersTable).where(inArray(usersTable.id, senderIds))
    : [];
  const senderEmailById = Object.fromEntries(senders.map((s) => [s.id, s.email]));

  const whispIds = items.map((w) => w.id);
  const categories = whispIds.length
    ? await db.select().from(whispCategoriesTable).where(inArray(whispCategoriesTable.whispId, whispIds)).orderBy(asc(whispCategoriesTable.rank))
    : [];
  const categoriesByWhisp: Record<string, typeof categories> = {};
  for (const c of categories) {
    (categoriesByWhisp[c.whispId] ??= []).push(c);
  }

  res.json({
    items: items.map((w) => ({
      ...w,
      senderEmail: senderEmailById[w.senderId] ?? null,
      categories: categoriesByWhisp[w.id] ?? [],
    })),
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

  const [sender, trackingEvents, replies, categories] = await Promise.all([
    db.select().from(usersTable).where(eq(usersTable.id, whisp.senderId)).then((r) => r[0]),
    db.select().from(trackingEventsTable).where(eq(trackingEventsTable.whispId, whisp.id)).orderBy(asc(trackingEventsTable.createdAt)),
    db.select().from(whispRepliesTable).where(eq(whispRepliesTable.whispId, whisp.id)).orderBy(asc(whispRepliesTable.createdAt)),
    db.select().from(whispCategoriesTable).where(eq(whispCategoriesTable.whispId, whisp.id)).orderBy(asc(whispCategoriesTable.rank)),
  ]);

  res.json({
    whisp,
    senderId: sender?.id ?? null,
    senderEmail: sender?.email ?? null,
    senderFullName: sender?.fullName ?? null,
    trackingEvents,
    replies,
    categories,
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
  const [byCountry, byCity, unknownRow, totalRow] = await Promise.all([
    db
      .select({ country: usersTable.country, count: count() })
      .from(usersTable)
      .where(isNotNull(usersTable.country))
      .groupBy(usersTable.country)
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
    byCity,
    unknownLocationUsers: unknownRow?.count ?? 0,
    totalUsers: totalRow?.count ?? 0,
  });
});

// GET /api/admin/stats/opportunities
router.get("/stats/opportunities", async (_req, res): Promise<void> => {
  const insights = await computeOpportunities();
  res.json({ insights });
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
