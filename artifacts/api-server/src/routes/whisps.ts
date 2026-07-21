import { Router } from "express";
import { getAuth } from "@clerk/express";
import { db } from "@workspace/db";
import {
  whispsTable,
  whispRepliesTable,
  trackingEventsTable,
  usersTable,
  creditTransactionsTable,
  circleMembersTable,
} from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";
import { randomUUID } from "crypto";
import { z } from "zod";
import { requireAuth } from "../lib/auth";
import { ensureUser } from "../lib/ensureUser";
import { getPublicAppUrl } from "../lib/publicUrl";
import { deliverWhisperLink } from "../lib/deliver";
import { categorizeWhispAsync } from "../lib/categorizeWhisp";
import { computeExpiresAt } from "../lib/expiration";
import { whisperLinkLimitFor, GHOST_BOOST_COST_USD } from "../lib/plans";
import { createWhispLimiter } from "../lib/rateLimit";

const router = Router();

const DELIVERY_METHODS = ["whisper_link", "ghost_boost", "circle_drop"] as const;
const WHISPER_CHANNELS = ["email", "sms", "whatsapp"] as const;

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
router.post("/", requireAuth, createWhispLimiter, async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  const user = await ensureUser(userId!, req);

  const schema = z.object({
    videoUrl: z.string().min(1),
    videoTitle: z.string().nullable().optional(),
    videoThumbnail: z.string().nullable().optional(),
    videoEmbedUrl: z.string().nullable().optional(),
    videoStartSeconds: z.number().int().min(0).nullable().optional(),
    videoPlatform: z.string().nullable().optional(),
    deliveryMethod: z.enum(DELIVERY_METHODS),
    whisperChannel: z.enum(WHISPER_CHANNELS).nullable().optional(),
    circleId: z.string().nullable().optional(),
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

  if (data.deliveryMethod === "whisper_link") {
    if (!data.whisperChannel) {
      res.status(400).json({ error: "Whisper Link requires a delivery channel (email, sms, or whatsapp)" });
      return;
    }
    if (data.whisperChannel === "email" && !data.recipientEmail) {
      res.status(400).json({ error: "Email delivery requires a recipient email address" });
      return;
    }
    if ((data.whisperChannel === "sms" || data.whisperChannel === "whatsapp") && !data.recipientPhone) {
      res.status(400).json({ error: "Text/WhatsApp delivery requires a recipient phone number" });
      return;
    }
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

  if (data.deliveryMethod === "circle_drop" && data.circleId) {
    const membership = await db
      .select()
      .from(circleMembersTable)
      .where(and(eq(circleMembersTable.circleId, data.circleId), eq(circleMembersTable.userId, user.id)))
      .then(r => r[0]);
    if (!membership) {
      res.status(403).json({ error: "You're not a member of that circle" });
      return;
    }
  }

  const id = randomUUID();
  const publicToken = randomUUID().replace(/-/g, "");
  const isGhostBoost = data.deliveryMethod === "ghost_boost";
  const scheduledDate = data.scheduledAt ? new Date(data.scheduledAt) : null;
  // Ghost Boost's own "pending" status already means "queued, no live ad
  // integration" — scheduling isn't layered on top of that.
  const isScheduled = !isGhostBoost && scheduledDate !== null && scheduledDate.getTime() > Date.now();

  await db.insert(whispsTable).values({
    id,
    senderId: user.id,
    videoUrl: data.videoUrl,
    videoTitle: data.videoTitle ?? null,
    videoThumbnail: data.videoThumbnail ?? null,
    videoEmbedUrl: data.videoEmbedUrl ?? null,
    videoStartSeconds: data.videoStartSeconds ?? null,
    videoPlatform: data.videoPlatform ?? null,
    deliveryMethod: data.deliveryMethod,
    whisperChannel: data.deliveryMethod === "whisper_link" ? data.whisperChannel ?? null : null,
    circleId: data.deliveryMethod === "circle_drop" ? data.circleId ?? null : null,
    recipientEmail: data.recipientEmail ?? null,
    recipientPhone: data.recipientPhone ?? null,
    anonymousNote: data.anonymousNote ?? null,
    senderAlias: data.senderAlias ?? null,
    moodTag: data.moodTag ?? null,
    status: isGhostBoost ? "pending" : isScheduled ? "scheduled" : "delivered",
    publicToken,
    scheduledAt: scheduledDate,
    deliveredAt: isGhostBoost || isScheduled ? null : new Date(),
    expiresAt: data.deliveryMethod === "whisper_link" && !isScheduled ? computeExpiresAt() : null,
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

  // The shared link goes through /l/:token (server-rendered) rather than
  // straight to /w/:token (the SPA) so link-preview crawlers in
  // email/SMS/WhatsApp clients see a real per-video Open Graph card instead
  // of the app's generic static shell. Scheduled whisps are dispatched later
  // by lib/scheduler.ts when their scheduledAt comes due.
  if (data.deliveryMethod === "whisper_link" && !isScheduled) {
    deliverWhisperLink(
      { publicToken, whisperChannel: data.whisperChannel ?? null, recipientEmail: data.recipientEmail ?? null, recipientPhone: data.recipientPhone ?? null },
      getPublicAppUrl(req),
    );
  }

  // Video content categorization (admin analytics only) runs independently
  // of delivery — it's about what the video is, not whether/when it's sent.
  void categorizeWhispAsync({
    id,
    videoUrl: data.videoUrl,
    videoTitle: data.videoTitle ?? null,
    videoPlatform: data.videoPlatform ?? null,
  });

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

// PATCH /api/whisps/:id/reveal — called by the (unauthenticated) recipient,
// so the response must stay limited to what the public whisp page already
// shows. It must never return the full row: that would hand out senderId,
// recipientEmail/Phone, and everything else to anyone who has (or later
// obtains — a forwarded link, a leaked referrer, etc.) this whisp id.
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

  if (!whisp.revealRequested) {
    res.status(400).json({ error: "No reveal has been requested for this whisp" });
    return;
  }

  await db
    .update(whispsTable)
    .set({ revealAccepted: parsed.data.accepted })
    .where(eq(whispsTable.id, whisp.id));

  res.json({ id: whisp.id, revealRequested: true, revealAccepted: parsed.data.accepted });
});

export default router;
