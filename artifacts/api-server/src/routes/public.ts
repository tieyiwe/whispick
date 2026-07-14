import { Router } from "express";
import { db } from "@workspace/db";
import {
  whispsTable,
  whispRepliesTable,
  trackingEventsTable,
  usersTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import { z } from "zod";
import { sendEmail, replyNotificationEmailHtml } from "../lib/email";
import { notifyUser } from "../lib/push";
import { getPublicAppUrl } from "../lib/publicUrl";

const router = Router();

// GET /api/public/w/:token — public recipient page
router.get("/w/:token", async (req, res): Promise<void> => {
  const whisp = await db
    .select()
    .from(whispsTable)
    .where(eq(whispsTable.publicToken, req.params.token))
    .then(r => r[0]);

  if (!whisp) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  // Return only public-safe fields
  res.json({
    id: whisp.id,
    videoUrl: whisp.videoUrl,
    videoTitle: whisp.videoTitle,
    videoThumbnail: whisp.videoThumbnail,
    videoEmbedUrl: whisp.videoEmbedUrl,
    videoStartSeconds: whisp.videoStartSeconds,
    videoPlatform: whisp.videoPlatform,
    anonymousNote: whisp.anonymousNote,
    senderAlias: whisp.senderAlias,
    moodTag: whisp.moodTag,
    revealRequested: whisp.revealRequested,
  });
});

// POST /api/public/w/:token/track — tracking pixel
router.post("/w/:token/track", async (req, res): Promise<void> => {
  const schema = z.object({ eventType: z.string().min(1) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid event type" });
    return;
  }

  const whisp = await db
    .select()
    .from(whispsTable)
    .where(eq(whispsTable.publicToken, req.params.token))
    .then(r => r[0]);

  if (!whisp) {
    res.json({ ok: true }); // Silent success even if not found
    return;
  }

  const id = randomUUID();
  await db.insert(trackingEventsTable).values({
    id,
    whispId: whisp.id,
    eventType: parsed.data.eventType,
    userAgent: req.headers["user-agent"] ?? null,
    ipHash: null,
  });

  // Update whisp status based on event. "replied" is a more meaningful
  // terminal state than "watched" — e.g. a recipient can reply mid-video and
  // then keep watching, firing watched_complete afterwards — so a later
  // watched_complete must not silently regress the status back from
  // "replied", which would make the whisp vanish from the Replies Inbox and
  // undercount the Dashboard's reply stat despite the reply still existing.
  const eventType = parsed.data.eventType;
  const whispUrl = `${getPublicAppUrl(req)}/whisps/${whisp.id}`;
  if (eventType === "opened" && !whisp.openedAt) {
    await db.update(whispsTable).set({ status: "opened", openedAt: new Date() }).where(eq(whispsTable.id, whisp.id));
    void notifyUser(whisp.senderId, "Your whisp was opened 👀", "Someone just opened the link you sent.", whispUrl);
  } else if (eventType === "watched_complete" && !whisp.watchedAt) {
    await db
      .update(whispsTable)
      .set({ watchedAt: new Date(), ...(whisp.status === "replied" ? {} : { status: "watched" }) })
      .where(eq(whispsTable.id, whisp.id));
    void notifyUser(whisp.senderId, "They watched it 🎬", "Your whisp was watched all the way through.", whispUrl);
  }

  res.json({ ok: true });
});

// POST /api/public/w/:token/reply — anonymous reply from recipient, optionally
// a "whisp back": a video sent through the same anonymous channel instead of
// (or alongside) text, keeping the exchange going both ways.
router.post("/w/:token/reply", async (req, res): Promise<void> => {
  const schema = z
    .object({
      replyText: z.string().max(300).nullable().optional(),
      videoUrl: z.string().nullable().optional(),
      videoTitle: z.string().nullable().optional(),
      videoThumbnail: z.string().nullable().optional(),
      videoEmbedUrl: z.string().nullable().optional(),
      videoPlatform: z.string().nullable().optional(),
      moodTag: z.string().nullable().optional(),
    })
    .refine((data) => !!data.replyText?.trim() || !!data.videoUrl, {
      message: "Reply must include text or a video",
    });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const whisp = await db
    .select()
    .from(whispsTable)
    .where(eq(whispsTable.publicToken, req.params.token))
    .then(r => r[0]);

  if (!whisp) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const id = randomUUID();
  await db.insert(whispRepliesTable).values({
    id,
    whispId: whisp.id,
    replyText: parsed.data.replyText?.trim() || "",
    fromRecipient: true,
    videoUrl: parsed.data.videoUrl ?? null,
    videoTitle: parsed.data.videoTitle ?? null,
    videoThumbnail: parsed.data.videoThumbnail ?? null,
    videoEmbedUrl: parsed.data.videoEmbedUrl ?? null,
    videoPlatform: parsed.data.videoPlatform ?? null,
    moodTag: parsed.data.moodTag ?? null,
  });

  // Update whisp status to replied
  await db.update(whispsTable).set({ status: "replied" }).where(eq(whispsTable.id, whisp.id));

  const sender = await db.select().from(usersTable).where(eq(usersTable.id, whisp.senderId)).then(r => r[0]);
  if (sender?.email) {
    void sendEmail(sender.email, "Someone replied to your whisp", replyNotificationEmailHtml(whisp.videoTitle));
  }
  void notifyUser(
    whisp.senderId,
    "You got a reply 💬",
    parsed.data.videoUrl ? "Someone whisped a video back to you." : "Someone replied anonymously to your whisp.",
    `${getPublicAppUrl(req)}/whisps/${whisp.id}`,
  );

  const reply = await db.select().from(whispRepliesTable).where(eq(whispRepliesTable.id, id)).then(r => r[0]);
  res.status(201).json(reply);
});

export default router;
