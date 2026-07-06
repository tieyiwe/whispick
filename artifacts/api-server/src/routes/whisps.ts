import { Router } from "express";
import { getAuth } from "@clerk/express";
import { db } from "@workspace/db";
import {
  whispsTable,
  whispRepliesTable,
  trackingEventsTable,
  usersTable,
} from "@workspace/db";
import { eq, and, count, sql } from "drizzle-orm";
import { randomUUID } from "crypto";
import { z } from "zod";

const router = Router();

function requireAuth(req: any, res: any, next: any) {
  const { userId } = getAuth(req);
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}

async function ensureUser(clerkId: string, req: any) {
  let user = await db.select().from(usersTable).where(eq(usersTable.clerkId, clerkId)).then(r => r[0]);
  if (!user) {
    const id = randomUUID();
    const email = req.auth?.sessionClaims?.email as string ?? `${clerkId}@whispr.app`;
    await db.insert(usersTable).values({
      id,
      clerkId,
      email,
      plan: "free",
      boostCredits: 0,
      whisperLinksUsed: 0,
    });
    user = await db.select().from(usersTable).where(eq(usersTable.clerkId, clerkId)).then(r => r[0]);
  }
  return user!;
}

// GET /api/whisps
router.get("/", requireAuth, async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  const user = await ensureUser(userId!, req);

  const statusFilter = req.query.status as string | undefined;
  let query = db.select().from(whispsTable).where(eq(whispsTable.senderId, user.id));

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
    videoPlatform: z.string().nullable().optional(),
    deliveryMethod: z.string().min(1),
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
  const id = randomUUID();
  const publicToken = randomUUID().replace(/-/g, "");

  await db.insert(whispsTable).values({
    id,
    senderId: user.id,
    videoUrl: data.videoUrl,
    videoTitle: data.videoTitle ?? null,
    videoThumbnail: data.videoThumbnail ?? null,
    videoPlatform: data.videoPlatform ?? null,
    deliveryMethod: data.deliveryMethod,
    recipientEmail: data.recipientEmail ?? null,
    recipientPhone: data.recipientPhone ?? null,
    anonymousNote: data.anonymousNote ?? null,
    senderAlias: data.senderAlias ?? null,
    moodTag: data.moodTag ?? null,
    status: "delivered",
    publicToken,
    scheduledAt: data.scheduledAt ? new Date(data.scheduledAt) : null,
    deliveredAt: new Date(),
  });

  // Increment whisper links used
  if (data.deliveryMethod === "whisper_link") {
    await db
      .update(usersTable)
      .set({ whisperLinksUsed: sql`${usersTable.whisperLinksUsed} + 1` })
      .where(eq(usersTable.id, user.id));
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
