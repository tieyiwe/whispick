import { Router } from "express";
import { db } from "@workspace/db";
import {
  whispsTable,
  whispRepliesTable,
  trackingEventsTable,
  usersTable,
  uploadedVideosTable,
} from "@workspace/db";
import { eq, count } from "drizzle-orm";
import { randomUUID } from "crypto";
import { z } from "zod";
import { sendEmail, appreciationNotificationEmailHtml } from "../lib/email";
import { notifyUserPersisted } from "../lib/push";
import { getPublicAppUrl } from "../lib/publicUrl";
import { isExpired, MAX_REMINDERS } from "../lib/expiration";
import { downloadObject } from "../lib/objectStorage";
import { generateTakeawayAsync } from "../lib/aiTakeaway";
import { httpUrlString } from "../lib/safeUrl";
import { deriveVideoFields } from "../lib/videoMeta";

const router = Router();

// A Ghost Boost fan-out row (see lib/matching.ts) shares its senderId with
// the campaign it belongs to, but the sender's only intended visibility into
// it is the aggregate stats on GET /whisps/:id/matches — never a per-event
// notification, which would both leak that one specific stranger did
// something (breaking "anonymous both ways") and hand the sender a whisp id
// that, if any endpoint's ownership check ever missed the exclude filter,
// could be used to look up that one subscriber's own reply/interaction.
function isMatchedFanout(whisp: { deliveryMethod: string; groupSendId: string | null }): boolean {
  return whisp.deliveryMethod === "ghost_boost" && !!whisp.groupSendId;
}

// One of 3, 5, or 9 minutes out, chosen at random each time — a discrete
// choice (not a continuous range) per the anti-correlation design: enough
// spread that a Sender's phone buzzing can't be tied to a Recipient who just
// hit send while physically next to them. See notifySenderAt's schema
// comment and lib/replyNotificationScheduler.ts.
const NOTIFY_DELAY_MINUTES_OPTIONS = [3, 5, 9] as const;
function randomNotifyDelay(): Date {
  const minutes = NOTIFY_DELAY_MINUTES_OPTIONS[Math.floor(Math.random() * NOTIFY_DELAY_MINUTES_OPTIONS.length)];
  return new Date(Date.now() + minutes * 60_000);
}

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

  let groupSize: number | null = null;
  if (whisp.deliveryMethod === "group_whisper" && whisp.groupSendId) {
    const row = await db
      .select({ count: count() })
      .from(whispsTable)
      .where(eq(whispsTable.groupSendId, whisp.groupSendId))
      .then((r) => r[0]);
    groupSize = row?.count ?? 1;
  }

  // The reply thread, same as the sender's own WhispDetail view gets — none
  // of these fields are sender-identifying (no senderId/email/phone), so
  // there's nothing here that breaks the "recipient never learns who sent
  // this" guarantee. Without this, a recipient could send a reply but never
  // see it (or any sender follow-up) again on a later visit — every reply
  // looked like it vanished into a one-shot box instead of a real thread.
  const replies = await db
    .select()
    .from(whispRepliesTable)
    .where(eq(whispRepliesTable.whispId, whisp.id))
    .orderBy(whispRepliesTable.createdAt);

  // Return only public-safe fields
  res.json({
    id: whisp.id,
    videoUrl: whisp.videoUrl,
    videoTitle: whisp.videoTitle,
    videoThumbnail: whisp.videoThumbnail,
    videoEmbedUrl: whisp.videoEmbedUrl,
    videoStartSeconds: whisp.videoStartSeconds,
    videoEndSeconds: whisp.videoEndSeconds,
    videoPlatform: whisp.videoPlatform,
    anonymousNote: whisp.anonymousNote,
    senderAlias: whisp.senderAlias,
    moodTag: whisp.moodTag,
    revealRequested: whisp.revealRequested,
    groupSize,
    appreciationResponse: whisp.appreciationResponse,
    expiresAt: whisp.expiresAt,
    reminderCount: whisp.reminderCount,
    expired: isExpired(whisp.expiresAt),
    hasUpload: !!whisp.uploadedVideoId,
    aiTakeaway: whisp.aiTakeaway,
    aiTakeawayStatus: whisp.aiTakeawayStatus,
    replies,
  });
});

async function loadWhispUpload(token: string) {
  const whisp = await db.select().from(whispsTable).where(eq(whispsTable.publicToken, token)).then((r) => r[0]);
  if (!whisp?.uploadedVideoId) return { status: 404 as const };
  // GET /w/:token already reports `expired` and the frontend stops rendering
  // the video player once it's true, but that's a client-side-only gate —
  // without this check the raw bytes stayed fetchable forever via a direct
  // request to this endpoint, past the 48-hour window whisps.expiresAt (and
  // the countdown/reminder UI) advertise to the recipient as the whole
  // point of "this expires."
  if (isExpired(whisp.expiresAt)) return { status: 410 as const };

  const media = await db
    .select()
    .from(uploadedVideosTable)
    .where(eq(uploadedVideosTable.id, whisp.uploadedVideoId))
    .then((r) => r[0]);

  if (!media) return { status: 404 as const };
  if (media.status !== "ready") return { status: 410 as const };
  return { status: 200 as const, media };
}

// GET /api/public/w/:token/media — streams an uploaded (device) video's
// bytes. Scoped by the whisp's own public token (possession-of-token is this
// app's whole trust model for public routes), not by a raw media id, so a
// recipient can never probe someone else's library by guessing ids.
router.get("/w/:token/media", async (req, res): Promise<void> => {
  const result = await loadWhispUpload(req.params.token);
  if (result.status !== 200) {
    res.status(result.status).json({ error: result.status === 410 ? "This video is no longer available" : "Not found" });
    return;
  }

  const bytes = await downloadObject(result.media.objectKey);
  if (!bytes) {
    res.status(503).json({ error: "Video storage is temporarily unavailable" });
    return;
  }

  res.setHeader("Content-Type", result.media.mimeType);
  res.setHeader("Content-Length", String(bytes.length));
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.send(bytes);
});

// GET /api/public/w/:token/media/thumbnail
router.get("/w/:token/media/thumbnail", async (req, res): Promise<void> => {
  const result = await loadWhispUpload(req.params.token);
  if (result.status !== 200 || !result.media.thumbnailObjectKey) {
    res.status(result.status === 410 ? 410 : 404).json({ error: "Not found" });
    return;
  }

  const bytes = await downloadObject(result.media.thumbnailObjectKey);
  if (!bytes) {
    res.status(503).json({ error: "Thumbnail storage is temporarily unavailable" });
    return;
  }

  res.setHeader("Content-Type", "image/jpeg");
  res.setHeader("Content-Length", String(bytes.length));
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.send(bytes);
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

  if (isExpired(whisp.expiresAt)) {
    res.json({ ok: true }); // Silent success — expired whisp shouldn't move status or notify
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
    if (!isMatchedFanout(whisp)) {
      void notifyUserPersisted(whisp.senderId, "Your whisp was opened 👀", "Someone just opened the link you sent.", whispUrl);
    }
  } else if (eventType === "watched_complete" && !whisp.watchedAt) {
    await db
      .update(whispsTable)
      .set({ watchedAt: new Date(), ...(whisp.status === "replied" ? {} : { status: "watched" }) })
      .where(eq(whispsTable.id, whisp.id));
    if (!isMatchedFanout(whisp)) {
      void notifyUserPersisted(whisp.senderId, "They watched it 🎬", "Your whisp was watched all the way through.", whispUrl);
    }
    void generateTakeawayAsync(whisp.id);
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
      // httpUrlString, not plain string: these come from an UNAUTHENTICATED
      // caller and are later rendered as href/iframe-src in the sender's
      // logged-in session — a javascript: URL here would be stored XSS.
      videoUrl: httpUrlString.nullable().optional(),
      videoTitle: z.string().max(300).nullable().optional(),
      videoThumbnail: httpUrlString.nullable().optional(),
      videoEmbedUrl: httpUrlString.nullable().optional(),
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

  if (isExpired(whisp.expiresAt)) {
    res.status(410).json({ error: "This whisp has expired" });
    return;
  }

  const id = randomUUID();
  // Delayed by a random 3/5/9 minutes so the Sender's notification doesn't
  // fire in this same request — see notifySenderAt's comment in the schema
  // and lib/replyNotificationScheduler.ts, which dispatches it once due.
  // Only meaningful for this recipient-authored direction (fromRecipient:
  // true); sender-authored follow-ups inserted elsewhere leave it null.
  const notifySenderAt = isMatchedFanout(whisp) ? null : randomNotifyDelay();
  // Derive thumbnail/embed/platform server-side from the pasted URL, never
  // from the client. This reply is auto-loaded in the SENDER's browser, so a
  // recipient-supplied thumbnail/embed URL pointing at an attacker host would
  // silently leak the sender's IP/geolocation to the recipient the first time
  // they open the thread — a direct break of the app's core sender/recipient
  // anonymity guarantee. See lib/videoMeta.ts deriveVideoFields.
  const replyDerived = parsed.data.videoUrl ? deriveVideoFields(parsed.data.videoUrl) : null;
  await db.insert(whispRepliesTable).values({
    id,
    whispId: whisp.id,
    replyText: parsed.data.replyText?.trim() || "",
    fromRecipient: true,
    videoUrl: parsed.data.videoUrl ?? null,
    videoTitle: parsed.data.videoTitle ?? null,
    videoThumbnail: replyDerived?.thumbnail ?? null,
    videoEmbedUrl: replyDerived?.embedUrl ?? null,
    videoPlatform: replyDerived?.platform ?? null,
    moodTag: parsed.data.moodTag ?? null,
    notifySenderAt,
  });

  // Update whisp status to replied
  await db.update(whispsTable).set({ status: "replied" }).where(eq(whispsTable.id, whisp.id));

  const reply = await db.select().from(whispRepliesTable).where(eq(whispRepliesTable.id, id)).then(r => r[0]);
  res.status(201).json(reply);
});

// POST /api/public/w/:token/appreciation — the recipient's own answer to
// "was this something you needed to hear?" A 'yes' notifies the sender; a
// 'no' is recorded the same way but doesn't (no upside to a "they didn't
// like it" push). Overwritable — if they tap the other option afterwards,
// the latest answer wins and no second sender notification fires on a
// later change (only fires on a fresh answer, not a flip).
router.post("/w/:token/appreciation", async (req, res): Promise<void> => {
  const parsed = z.object({ appreciated: z.boolean() }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }

  const whisp = await db
    .select()
    .from(whispsTable)
    .where(eq(whispsTable.publicToken, req.params.token))
    .then((r) => r[0]);

  if (!whisp) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  if (isExpired(whisp.expiresAt)) {
    res.status(410).json({ error: "This whisp has expired" });
    return;
  }

  const alreadyAnswered = whisp.appreciationResponse !== null;
  const response = parsed.data.appreciated ? "yes" : "no";

  await db
    .update(whispsTable)
    .set({ appreciationResponse: response, appreciationRespondedAt: new Date() })
    .where(eq(whispsTable.id, whisp.id));

  if (parsed.data.appreciated && !alreadyAnswered && !isMatchedFanout(whisp)) {
    const sender = await db.select().from(usersTable).where(eq(usersTable.id, whisp.senderId)).then((r) => r[0]);
    if (sender?.email) {
      void sendEmail(sender.email, "They needed to hear that 💜", appreciationNotificationEmailHtml(whisp.videoTitle), {
        whispId: whisp.id,
        purpose: "appreciation_notification",
      });
    }
    void notifyUserPersisted(
      whisp.senderId,
      "They appreciated it 💜",
      "The person you sent your whisp to said it was something they needed to hear.",
      `${getPublicAppUrl(req)}/whisps/${whisp.id}`,
    );
  }

  res.json({ ok: true, appreciationResponse: response });
});

// POST /api/public/w/:token/remind-me — recipient asks to be re-notified
// later, up to MAX_REMINDERS times, no later than the whisp's expiresAt.
router.post("/w/:token/remind-me", async (req, res): Promise<void> => {
  const parsed = z.object({ minutes: z.number().int().positive() }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }

  const whisp = await db
    .select()
    .from(whispsTable)
    .where(eq(whispsTable.publicToken, req.params.token))
    .then((r) => r[0]);

  if (!whisp) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  if (!whisp.expiresAt) {
    res.status(400).json({ error: "Reminders aren't available for this whisp" });
    return;
  }

  if (isExpired(whisp.expiresAt)) {
    res.status(410).json({ error: "This whisp has expired" });
    return;
  }

  if (whisp.reminderCount >= MAX_REMINDERS) {
    res.status(400).json({ error: "No more reminders available for this whisp" });
    return;
  }

  const proposedTime = new Date(Date.now() + parsed.data.minutes * 60 * 1000);
  if (proposedTime.getTime() >= new Date(whisp.expiresAt).getTime()) {
    res.status(400).json({ error: "That reminder time is after this whisp expires" });
    return;
  }

  await db.update(whispsTable).set({ nextReminderAt: proposedTime }).where(eq(whispsTable.id, whisp.id));

  res.json({
    ok: true,
    nextReminderAt: proposedTime,
    isFinal: whisp.reminderCount + 1 >= MAX_REMINDERS,
  });
});

export default router;
