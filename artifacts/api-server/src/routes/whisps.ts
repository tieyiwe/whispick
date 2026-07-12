import { Router } from "express";
import { getAuth } from "@clerk/express";
import { db } from "@workspace/db";
import {
  whispsTable,
  whispRepliesTable,
  trackingEventsTable,
  usersTable,
  creditTransactionsTable,
} from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";
import { randomUUID } from "crypto";
import { z } from "zod";
import { requireAuth } from "../lib/auth";
import { ensureUser } from "../lib/ensureUser";
import { getPublicAppUrl } from "../lib/publicUrl";
import { sendEmail, whisperLinkEmailHtml, replyNotificationEmailHtml } from "../lib/email";
import { whisperLinkLimitFor, GHOST_BOOST_COST_USD } from "../lib/plans";
import { logger } from "../lib/logger";

const router = Router();

const DELIVERY_METHODS = ["whisper_link", "ghost_boost", "circle_drop"] as const;

// GET /api/whisps
router.get("/", requireAuth, async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  const user = await ensureUser(userId!, req);

  const statusFilter = req.query.status as string | undefined;

  const whisps = await db
    .select()
    .from(whispsTable)
    .where(
      statusFilter
        ? and(eq(whispsTable.senderId, user.id), eq(whispsTable.status, statusFilter))
        : eq(whispsTable.senderId, user.id),
    )
    .orderBy(sql`${whispsTable.createdAt} DESC`);

  res.json(whisps);
});

// POST /api/whisps
router.post("/", requireAuth, async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  const user = await ensureUser(userId!, req);

  const schema = z.object({
    videoUrl: z.string().min(1),
    videoTitle: z.string().nullable().optional(),
    videoThumbnail: z.string().nullable().optional(),
    videoEmbedUrl: z.string().nullable().optional(),
    videoPlatform: z.string().nullable().optional(),
    deliveryMethod: z.enum(DELIVERY_METHODS),
    recipientEmail: z.string().nullable().optional(),
    recipientPhone: z.string().nullable().optional(),
    anonymousNote: z.string().nullable().optional(),
    senderAlias: z.string().nullable().optional(),
    moodTag: z.string().nullable().optional(),
    scheduledAt: z.string().nullable().optional(),
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const data = parsed.data;

  if (data.deliveryMethod === "whisper_link" && !data.recipientEmail && !data.recipientPhone) {
    res.status(400).json({ error: "Whisper Link requires a recipient email or phone number" });
    return;
  }

  // Free-plan Whisper Link monthly limit, reset on a rolling 30-day window
  if (data.deliveryMethod === "whisper_link") {
    const limit = whisperLinkLimitFor(user.plan);
    const now = new Date();
    const resetDue = !user.whisperLinksResetAt || user.whisperLinksResetAt <= now;
    const usedThisPeriod = resetDue ? 0 : user.whisperLinksUsed;

    if (limit !== null && usedThisPeriod >= limit) {
      res.status(402).json({ error: `Whisper Link limit reached for the ${user.plan} plan. Upgrade to send more.` });
      return;
    }

    if (resetDue) {
      const nextReset = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
      await db
        .update(usersTable)
        .set({ whisperLinksUsed: 1, whisperLinksResetAt: nextReset })
        .where(eq(usersTable.id, user.id));
    } else {
      await db
        .update(usersTable)
        .set({ whisperLinksUsed: sql`${usersTable.whisperLinksUsed} + 1` })
        .where(eq(usersTable.id, user.id));
    }
  }

  // Ghost Boost spends a credit up front; there's no live ad-platform
  // integration, so the whisp is queued rather than marked delivered.
  if (data.deliveryMethod === "ghost_boost") {
    if (user.boostCredits < 1) {
      res.status(402).json({ error: "Insufficient Ghost Boost credits. Purchase more from Credits & Plan." });
      return;
    }
    await db
      .update(usersTable)
      .set({ boostCredits: sql`${usersTable.boostCredits} - 1` })
      .where(eq(usersTable.id, user.id));
  }

  const id = randomUUID();
  const publicToken = randomUUID().replace(/-/g, "");
  const isGhostBoost = data.deliveryMethod === "ghost_boost";

  await db.insert(whispsTable).values({
    id,
    senderId: user.id,
    videoUrl: data.videoUrl,
    videoTitle: data.videoTitle ?? null,
    videoThumbnail: data.videoThumbnail ?? null,
    videoEmbedUrl: data.videoEmbedUrl ?? null,
    videoPlatform: data.videoPlatform ?? null,
    deliveryMethod: data.deliveryMethod,
    recipientEmail: data.recipientEmail ?? null,
    recipientPhone: data.recipientPhone ?? null,
    anonymousNote: data.anonymousNote ?? null,
    senderAlias: data.senderAlias ?? null,
    moodTag: data.moodTag ?? null,
    status: isGhostBoost ? "pending" : "delivered",
    publicToken,
    scheduledAt: data.scheduledAt ? new Date(data.scheduledAt) : null,
    deliveredAt: isGhostBoost ? null : new Date(),
    boostSpendUsd: isGhostBoost ? String(GHOST_BOOST_COST_USD) : null,
  });

  if (isGhostBoost) {
    await db.insert(creditTransactionsTable).values({
      id: randomUUID(),
      userId: user.id,
      type: "spend",
      amount: -1,
      whispId: id,
    });
  }

  if (data.deliveryMethod === "whisper_link" && data.recipientEmail) {
    const publicUrl = `${getPublicAppUrl(req)}/w/${publicToken}`;
    void sendEmail(data.recipientEmail, "Someone thought you should see this", whisperLinkEmailHtml(publicUrl));
  }

  const whisp = await db.select().from(whispsTable).where(eq(whispsTable.id, id)).then(r => r[0]);
  res.status(201).json(whisp);
});

// GET /api/whisps/stats
router.get("/stats", requireAuth, async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  const user = await ensureUser(userId!, req);

  const allWhisps = await db
    .select()
    .from(whispsTable)
    .where(eq(whispsTable.senderId, user.id))
    .orderBy(sql`${whispsTable.createdAt} DESC`);

  const totalSent = allWhisps.length;
  const totalOpened = allWhisps.filter(w => w.openedAt).length;
  const totalWatched = allWhisps.filter(w => w.watchedAt).length;
  const totalReplied = allWhisps.filter(w => w.status === "replied").length;
  const deliveryRate = totalSent > 0 ? (allWhisps.filter(w => w.deliveredAt).length / totalSent) * 100 : 0;
  const openRate = totalSent > 0 ? (totalOpened / totalSent) * 100 : 0;

  res.json({
    totalSent,
    totalOpened,
    totalWatched,
    totalReplied,
    deliveryRate: Math.round(deliveryRate),
    openRate: Math.round(openRate),
    boostCredits: user.boostCredits,
    plan: user.plan,
    recentWhisps: allWhisps.slice(0, 5),
  });
});

// GET /api/whisps/:id
router.get("/:id", requireAuth, async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  const user = await ensureUser(userId!, req);

  const whisp = await db
    .select()
    .from(whispsTable)
    .where(and(eq(whispsTable.id, req.params.id), eq(whispsTable.senderId, user.id)))
    .then(r => r[0]);

  if (!whisp) {
    res.status(404).json({ error: "Whisp not found" });
    return;
  }

  const trackingEvents = await db
    .select()
    .from(trackingEventsTable)
    .where(eq(trackingEventsTable.whispId, whisp.id))
    .orderBy(sql`${trackingEventsTable.createdAt} ASC`);

  const replies = await db
    .select()
    .from(whispRepliesTable)
    .where(eq(whispRepliesTable.whispId, whisp.id))
    .orderBy(sql`${whispRepliesTable.createdAt} ASC`);

  res.json({ whisp, trackingEvents, replies });
});

// DELETE /api/whisps/:id
router.delete("/:id", requireAuth, async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  const user = await ensureUser(userId!, req);

  const whisp = await db
    .select()
    .from(whispsTable)
    .where(and(eq(whispsTable.id, req.params.id), eq(whispsTable.senderId, user.id)))
    .then(r => r[0]);

  if (!whisp) {
    res.status(404).json({ error: "Whisp not found" });
    return;
  }

  await db.delete(whispRepliesTable).where(eq(whispRepliesTable.whispId, whisp.id));
  await db.delete(trackingEventsTable).where(eq(trackingEventsTable.whispId, whisp.id));
  await db.delete(whispsTable).where(eq(whispsTable.id, whisp.id));

  res.status(204).send();
});

// GET /api/whisps/:id/replies
router.get("/:id/replies", requireAuth, async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  const user = await ensureUser(userId!, req);

  const whisp = await db
    .select()
    .from(whispsTable)
    .where(and(eq(whispsTable.id, req.params.id), eq(whispsTable.senderId, user.id)))
    .then(r => r[0]);

  if (!whisp) {
    res.status(404).json({ error: "Whisp not found" });
    return;
  }

  const replies = await db
    .select()
    .from(whispRepliesTable)
    .where(eq(whispRepliesTable.whispId, whisp.id))
    .orderBy(sql`${whispRepliesTable.createdAt} ASC`);

  res.json(replies);
});

// POST /api/whisps/:id/replies
router.post("/:id/replies", requireAuth, async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  const user = await ensureUser(userId!, req);

  const whisp = await db
    .select()
    .from(whispsTable)
    .where(and(eq(whispsTable.id, req.params.id), eq(whispsTable.senderId, user.id)))
    .then(r => r[0]);

  if (!whisp) {
    res.status(404).json({ error: "Whisp not found" });
    return;
  }

  const schema = z.object({
    replyText: z.string().min(1).max(300),
    fromRecipient: z.boolean().optional(),
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const id = randomUUID();
  await db.insert(whispRepliesTable).values({
    id,
    whispId: whisp.id,
    replyText: parsed.data.replyText,
    fromRecipient: parsed.data.fromRecipient ?? false,
  });

  const reply = await db.select().from(whispRepliesTable).where(eq(whispRepliesTable.id, id)).then(r => r[0]);
  res.status(201).json(reply);
});

// POST /api/whisps/:id/reveal
router.post("/:id/reveal", requireAuth, async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  const user = await ensureUser(userId!, req);

  const whisp = await db
    .select()
    .from(whispsTable)
    .where(and(eq(whispsTable.id, req.params.id), eq(whispsTable.senderId, user.id)))
    .then(r => r[0]);

  if (!whisp) {
    res.status(404).json({ error: "Whisp not found" });
    return;
  }

  await db
    .update(whispsTable)
    .set({ revealRequested: true })
    .where(eq(whispsTable.id, whisp.id));

  const updated = await db.select().from(whispsTable).where(eq(whispsTable.id, whisp.id)).then(r => r[0]);
  res.json(updated);
});

// PATCH /api/whisps/:id/reveal
router.patch("/:id/reveal", async (req, res): Promise<void> => {
  const schema = z.object({ accepted: z.boolean() });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const whisp = await db
    .select()
    .from(whispsTable)
    .where(eq(whispsTable.id, req.params.id))
    .then(r => r[0]);

  if (!whisp) {
    res.status(404).json({ error: "Whisp not found" });
    return;
  }

  await db
    .update(whispsTable)
    .set({ revealAccepted: parsed.data.accepted })
    .where(eq(whispsTable.id, whisp.id));

  const updated = await db.select().from(whispsTable).where(eq(whispsTable.id, whisp.id)).then(r => r[0]);
  res.json(updated);
});

export default router;
