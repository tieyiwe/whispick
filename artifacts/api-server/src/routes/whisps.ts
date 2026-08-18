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
  uploadedVideosTable,
  conciergeRequestsTable,
} from "@workspace/db";
import { eq, and, sql, isNull, or, lt, gte } from "drizzle-orm";
import { randomUUID } from "crypto";
import { z } from "zod";
import { requireAuth } from "../lib/auth";
import { ensureUser } from "../lib/ensureUser";
import { getPublicAppUrl } from "../lib/publicUrl";
import { deliverWhisperLink } from "../lib/deliver";
import { revealRequestHookLine, newReplyHookLine } from "../lib/copy";
import { categorizeWhispAsync } from "../lib/categorizeWhisp";
import { moderateWhispAsync } from "../lib/moderation";
import { needsDemographics } from "../lib/demographics";
import { computeExpiresAt, MAX_SCHEDULE_DAYS } from "../lib/expiration";
import { MAX_SCHEDULE_DAYS_WITH_UPLOAD } from "../lib/uploads";
import { whisperLinkLimitFor, GHOST_BOOST_COST_USD, recipientReplyAllowance } from "../lib/plans";
import { createWhispLimiter, noteSuggestionLimiter, conciergeLimiter, publicEndpointLimiter } from "../lib/rateLimit";
import { getGhostBoostMatchStats } from "../lib/matching";
import { generateNoteSuggestions } from "../lib/noteSuggestions";
import { httpUrlString } from "../lib/safeUrl";
import { deriveVideoFields } from "../lib/videoMeta";
import { runConcierge, MAX_SITUATION_LENGTH } from "../lib/concierge";

const router = Router();

const DELIVERY_METHODS = ["whisper_link", "ghost_boost", "circle_drop"] as const;
const WHISPER_CHANNELS = ["email", "sms", "whatsapp"] as const;

// A Ghost Boost match fans out to one whisp row per matched subscriber
// (see lib/matching.ts), sharing the sender's own senderId — unlike Group
// Whisper's identical-looking fan-out, these rows carry a *stranger's*
// contact info the sender was never meant to see (anonymity here is
// deliberately two-way; Group Whisper's isn't, since the sender picked
// those contacts themselves). Excluded from every sender-facing whisp
// list/lookup; aggregate-only visibility lives at GET /:id/matches.
function excludeMatchDeliveries() {
  return or(sql`${whispsTable.deliveryMethod} != 'ghost_boost'`, isNull(whispsTable.groupSendId));
}

// Sender-initiated soft delete (see whisps.ts schema) — every sender-facing
// list/lookup excludes these, same as excludeMatchDeliveries() above.
// Deliberately not applied anywhere in routes/admin.ts.
function excludeDeleted() {
  return isNull(whispsTable.deletedBySenderAt);
}

const noteSuggestionsSchema = z.object({
  videoTitle: z.string().max(300).nullable().optional(),
  moodTag: z.string().max(50).nullable().optional(),
});

// POST /api/whisps/note-suggestions — "help me find the words" in the
// composer's anonymous-note step. Runs before a whisp exists (no whispId to
// key off of), so it's a plain request/response rather than the
// fire-and-forget pattern lib/aiTakeaway.ts uses. Rate-limited per user since
// every call spends a real (small) Claude API request.
router.post("/note-suggestions", requireAuth, noteSuggestionLimiter, async (req, res): Promise<void> => {
  const parsed = noteSuggestionsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const suggestions = await generateNoteSuggestions(parsed.data.videoTitle ?? null, parsed.data.moodTag ?? null);
  res.json({ suggestions });
});

const conciergeSchema = z.object({
  situation: z.string().min(1).max(MAX_SITUATION_LENGTH),
});

// POST /api/whisps/concierge — the "Not sure what to send?" entry point
// above the normal manual compose flow: the sender describes their
// situation in a sentence or two and gets back up to a few Suggestions
// Library videos that fit, plus a drafted anonymous note. Matches only
// against the existing curated library (lib/concierge.ts) rather than
// discovering anything new live — that's suggestionAgent.ts's separate
// background job. Every call is persisted to concierge_requests so the
// admin panel can show usage (and, via whisps.conciergeRequestId set on an
// eventual POST /api/whisps, whether it actually led to a send).
router.post("/concierge", requireAuth, conciergeLimiter, async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  const user = await ensureUser(userId!, req);

  const parsed = conciergeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const result = await runConcierge(parsed.data.situation);

  const id = randomUUID();
  await db.insert(conciergeRequestsTable).values({
    id,
    userId: user.id,
    situation: parsed.data.situation,
    matchedCategories: result.matchedCategories,
    suggestedVideoIds: result.videoSuggestions.map((v) => v.id),
    noteDraft: result.noteDraft,
  });

  res.json({
    requestId: id,
    videoSuggestions: result.videoSuggestions,
    noteDraft: result.noteDraft,
    matchedCategories: result.matchedCategories,
  });
});

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
        ? and(eq(whispsTable.senderId, user.id), eq(whispsTable.status, statusFilter), excludeMatchDeliveries(), excludeDeleted())
        : and(eq(whispsTable.senderId, user.id), excludeMatchDeliveries(), excludeDeleted()),
    )
    .orderBy(sql`${whispsTable.createdAt} DESC`);

  res.json(whisps);
});

// POST /api/whisps
router.post("/", requireAuth, createWhispLimiter, async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  const user = await ensureUser(userId!, req);

  // One-time demographic confirmation gate — independent of (and checked
  // before) content moderation below; see lib/demographics.ts. The frontend
  // intercepts this specific error to show a confirmation step, save via
  // PATCH /user/profile, then retry the same send.
  if (needsDemographics(user)) {
    res.status(428).json({ error: "Please confirm your gender and age range before sending your first whisp.", code: "demographics_required" });
    return;
  }

  const schema = z
    .object({
      // httpUrlString, not plain string: these end up as href/iframe-src in
      // the recipient's public page and the admin panel — a javascript: URL
      // here would be stored XSS in those viewers' sessions.
      videoUrl: httpUrlString.nullable().optional(),
      videoTitle: z.string().max(300).nullable().optional(),
      videoThumbnail: httpUrlString.nullable().optional(),
      videoEmbedUrl: httpUrlString.nullable().optional(),
      videoStartSeconds: z.number().int().min(0).max(86400).nullable().optional(),
      // min(1), not min(0): an end trim of 0 seconds is meaningless (no
      // clip has zero length) and the falsy 0 would otherwise slip past a
      // `!data.videoEndSeconds` check further down as if unset.
      videoEndSeconds: z.number().int().min(1).max(86400).nullable().optional(),
      videoPlatform: z.string().nullable().optional(),
      // A video from the sender's own Media Library instead of a pasted URL
      // — mutually exclusive with videoUrl (see the refine below).
      uploadedVideoId: z.string().nullable().optional(),
      deliveryMethod: z.enum(DELIVERY_METHODS),
      whisperChannel: z.enum(WHISPER_CHANNELS).nullable().optional(),
      circleId: z.string().nullable().optional(),
      // .email(), not a bare string: this value is handed straight to the
      // mail transport as the `to` address (lib/deliver.ts → sendEmail).
      // nodemailer parses `to` as an ADDRESS LIST, so an unvalidated
      // "victim@x.com, attacker@evil.com" silently delivered the whisp to
      // every address in it — one Whisper Link fanning out to arbitrarily
      // many strangers, bypassing the plan's per-send accounting and turning
      // the app into a relay for real mail from its own domain.
      recipientEmail: z.string().email().max(320).nullable().optional(),
      // Same reasoning for the SMS/WhatsApp side: this reaches the Twilio
      // `To` parameter. Constrained to plausible phone characters so it
      // can't carry a list or control characters (lib/phone.ts normalizes
      // for matching, but the send path uses this value directly).
      recipientPhone: z.string().max(32).regex(/^[+0-9()\-.\s]+$/, "Not a valid phone number").nullable().optional(),
      anonymousNote: z.string().nullable().optional(),
      senderAlias: z.string().nullable().optional(),
      moodTag: z.string().nullable().optional(),
      scheduledAt: z.string().nullable().optional(),
      // Set by the composer when the video and/or note came from the "Not
      // sure what to send?" concierge — see the ownership check below.
      // Purely an analytics correlation, never trusted for anything else.
      conciergeRequestId: z.string().nullable().optional(),
    })
    .refine((data) => !!data.videoUrl || !!data.uploadedVideoId, {
      message: "A video URL or an uploaded video is required",
    })
    .refine(
      (data) => data.videoEndSeconds == null || data.videoStartSeconds == null || data.videoEndSeconds > data.videoStartSeconds,
      { message: "The end time must be after the start time" },
    );

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const data = parsed.data;

  let uploadedVideo: typeof uploadedVideosTable.$inferSelect | null = null;
  if (data.uploadedVideoId) {
    const media = await db
      .select()
      .from(uploadedVideosTable)
      .where(and(eq(uploadedVideosTable.id, data.uploadedVideoId), eq(uploadedVideosTable.ownerId, user.id)))
      .then((r) => r[0]);
    if (!media || media.status !== "ready") {
      res.status(400).json({ error: "That uploaded video is no longer available" });
      return;
    }
    uploadedVideo = media;
  }

  // Never trust a client-supplied id past ownership: only ever set the FK
  // when a concierge_requests row with this id really belongs to this
  // sender, same posture as the circle-membership check below. A stale,
  // mistyped, or someone-else's id just silently doesn't get recorded,
  // rather than failing the whole send over an analytics-only field.
  let conciergeRequestId: string | null = null;
  if (data.conciergeRequestId) {
    const conciergeRequest = await db
      .select({ id: conciergeRequestsTable.id })
      .from(conciergeRequestsTable)
      .where(and(eq(conciergeRequestsTable.id, data.conciergeRequestId), eq(conciergeRequestsTable.userId, user.id)))
      .then((r) => r[0]);
    conciergeRequestId = conciergeRequest?.id ?? null;
  }

  const isGhostBoost = data.deliveryMethod === "ghost_boost";
  const scheduledDate = data.scheduledAt ? new Date(data.scheduledAt) : null;
  // Ghost Boost's own "pending" status already means "queued, no live ad
  // integration" — scheduling isn't layered on top of that.
  const isScheduled = !isGhostBoost && scheduledDate !== null && scheduledDate.getTime() > Date.now();

  // Validated before any quota/credit is spent below, so a rejected schedule
  // never costs the sender a Whisper Link or a Ghost Boost credit.
  if (isScheduled) {
    const maxDays = uploadedVideo ? MAX_SCHEDULE_DAYS_WITH_UPLOAD : MAX_SCHEDULE_DAYS;
    const maxDate = new Date(Date.now() + maxDays * 24 * 60 * 60 * 1000);
    if (scheduledDate!.getTime() > maxDate.getTime()) {
      res.status(400).json({
        error: uploadedVideo
          ? `An uploaded video can only be scheduled up to ${maxDays} days out, so it doesn't expire before it's sent.`
          : `Please schedule within ${maxDays} days.`,
      });
      return;
    }
  }

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

  // Free-plan Whisper Link monthly limit, reset on a rolling 30-day window.
  // The check-and-increment must be a single atomic UPDATE, not a read
  // followed by a separate write: otherwise several concurrent sends all read
  // the same under-limit value, all pass the check, and all increment — a
  // free user fires N requests at once and blows past the cap.
  if (data.deliveryMethod === "whisper_link") {
    const limit = whisperLinkLimitFor(user.plan);
    const now = new Date();
    const resetDue = !user.whisperLinksResetAt || user.whisperLinksResetAt <= now;

    if (resetDue) {
      const nextReset = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
      await db
        .update(usersTable)
        .set({ whisperLinksUsed: 1, whisperLinksResetAt: nextReset })
        .where(eq(usersTable.id, user.id));
    } else if (limit === null) {
      await db
        .update(usersTable)
        .set({ whisperLinksUsed: sql`${usersTable.whisperLinksUsed} + 1` })
        .where(eq(usersTable.id, user.id));
    } else {
      // Atomic guarded increment: the `whisperLinksUsed < limit` predicate is
      // evaluated by the database as part of the same statement that does the
      // increment, so two concurrent requests can't both pass. Zero rows
      // affected ⇒ already at the cap.
      const incremented = await db
        .update(usersTable)
        .set({ whisperLinksUsed: sql`${usersTable.whisperLinksUsed} + 1` })
        .where(and(eq(usersTable.id, user.id), lt(usersTable.whisperLinksUsed, limit)))
        .returning({ id: usersTable.id });
      if (incremented.length === 0) {
        res.status(402).json({ error: `Whisper Link limit reached for the ${user.plan} plan. Upgrade to send more.` });
        return;
      }
    }
  }

  // Ghost Boost spends a credit up front; there's no live ad-platform
  // integration, so the whisp is queued rather than marked delivered. Same
  // atomicity requirement as the link limit above — a plain read-then-write
  // would let concurrent sends each see boostCredits >= 1 and both decrement,
  // driving the balance negative (this one spends real money, so it matters
  // more). The guarded UPDATE decrements only when the balance is still
  // sufficient, in one statement.
  if (data.deliveryMethod === "ghost_boost") {
    const spent = await db
      .update(usersTable)
      .set({ boostCredits: sql`${usersTable.boostCredits} - 1` })
      .where(and(eq(usersTable.id, user.id), gte(usersTable.boostCredits, 1)))
      .returning({ id: usersTable.id });
    if (spent.length === 0) {
      res.status(402).json({ error: "Insufficient Ghost Boost credits. Purchase more from Credits & Plan." });
      return;
    }
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

  // An uploaded video is never itself dereferenced by videoUrl — playback
  // goes through /public/w/:token/media instead — but the column is NOT
  // NULL, so a synthetic, unnavigable marker fills it.
  const effectiveVideoUrl = uploadedVideo ? `upload:${uploadedVideo.id}` : data.videoUrl!;
  const effectiveVideoTitle = data.videoTitle ?? uploadedVideo?.originalFilename ?? null;
  // Token-scoped (not media-id-scoped) so it resolves for ANY viewer who can
  // see this whisp — the recipient's public page, a Circle Drop browser, an
  // admin — not just the sender. The Media Library's own owner-only
  // /api/media/:id/thumbnail is for browsing uploads before they're
  // attached to a whisp (no token exists yet).
  // Never trust the client's videoThumbnail/videoEmbedUrl/videoPlatform —
  // they render as auto-loaded <img>/<iframe> in the recipient's (and
  // admin's) browser. Derive them server-side from the pasted URL instead
  // (see lib/videoMeta.ts deriveVideoFields).
  const derived = uploadedVideo ? null : deriveVideoFields(data.videoUrl!, data.videoThumbnail);
  const effectiveVideoThumbnail = uploadedVideo
    ? uploadedVideo.thumbnailObjectKey
      ? `/api/public/w/${publicToken}/media/thumbnail`
      : null
    : derived!.thumbnail;
  const effectiveVideoEmbedUrl = uploadedVideo ? null : derived!.embedUrl;
  const effectiveVideoPlatform = uploadedVideo ? "upload" : derived!.platform;

  await db.insert(whispsTable).values({
    id,
    senderId: user.id,
    videoUrl: effectiveVideoUrl,
    videoTitle: effectiveVideoTitle,
    videoThumbnail: effectiveVideoThumbnail,
    videoEmbedUrl: effectiveVideoEmbedUrl,
    videoStartSeconds: data.videoStartSeconds ?? null,
    videoEndSeconds: data.videoEndSeconds ?? null,
    videoPlatform: effectiveVideoPlatform,
    uploadedVideoId: uploadedVideo?.id ?? null,
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
    conciergeRequestId,
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

  // Read back and respond before kicking off the fire-and-forget delivery
  // send below — deliverWhisperLink awaits the actual Twilio/Resend call and
  // (for a failed initial send) updates this same row's status, so building
  // the response from a fresh select afterward would race it. The response
  // reflects the whisp as inserted (status 'delivered' = "attempted
  // delivery"); a transport failure discovered moments later is visible via
  // GET, not this response, same as the scheduled-send and reminder paths.
  const whisp = await db.select().from(whispsTable).where(eq(whispsTable.id, id)).then(r => r[0]);
  res.status(201).json(whisp);

  // The shared link goes through /l/:token (server-rendered) rather than
  // straight to /w/:token (the SPA) so link-preview crawlers in
  // email/SMS/WhatsApp clients see a real per-video Open Graph card instead
  // of the app's generic static shell. Scheduled whisps are dispatched later
  // by lib/scheduler.ts when their scheduledAt comes due.
  if (data.deliveryMethod === "whisper_link" && !isScheduled) {
    void deliverWhisperLink(
      { id, publicToken, whisperChannel: data.whisperChannel ?? null, recipientEmail: data.recipientEmail ?? null, recipientPhone: data.recipientPhone ?? null },
      getPublicAppUrl(req),
    );
  }

  // Video content categorization (admin analytics only) runs independently
  // of delivery — it's about what the video is, not whether/when it's sent.
  void categorizeWhispAsync({
    id,
    videoUrl: effectiveVideoUrl,
    videoTitle: effectiveVideoTitle,
    videoPlatform: effectiveVideoPlatform,
  });

  // Content-safety pass — also independent of delivery, runs on every whisp
  // regardless of channel (a Circle Drop or Ghost Boost's note/title can be
  // just as much a policy problem as a Whisper Link's).
  void moderateWhispAsync({
    id,
    senderId: user.id,
    videoUrl: effectiveVideoUrl,
    videoTitle: effectiveVideoTitle,
    videoPlatform: effectiveVideoPlatform,
    anonymousNote: data.anonymousNote ?? null,
  });
});

// GET /api/whisps/stats
router.get("/stats", requireAuth, async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  const user = await ensureUser(userId!, req);

  const allWhisps = await db
    .select()
    .from(whispsTable)
    .where(and(eq(whispsTable.senderId, user.id), excludeMatchDeliveries(), excludeDeleted()))
    .orderBy(sql`${whispsTable.createdAt} DESC`);

  const totalSent = allWhisps.length;
  const totalOpened = allWhisps.filter(w => w.openedAt).length;
  const totalWatched = allWhisps.filter(w => w.watchedAt).length;
  const totalReplied = allWhisps.filter(w => w.status === "replied").length;
  // The recipient's own answer to "was this something you needed to hear?"
  // (see whisps.appreciationResponse) was previously a private per-whisp
  // signal with no aggregate anywhere — the sender had no visible sense of
  // their overall impact, just isolated yes/no badges scattered across
  // individual whisp pages. Surfaced here as a running personal count.
  const totalAppreciated = allWhisps.filter(w => w.appreciationResponse === "yes").length;
  const deliveryRate = totalSent > 0 ? (allWhisps.filter(w => w.deliveredAt).length / totalSent) * 100 : 0;
  const openRate = totalSent > 0 ? (totalOpened / totalSent) * 100 : 0;

  res.json({
    totalSent,
    totalOpened,
    totalWatched,
    totalReplied,
    totalAppreciated,
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
    .where(and(eq(whispsTable.id, req.params.id), eq(whispsTable.senderId, user.id), excludeMatchDeliveries(), excludeDeleted()))
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

  // recipientRepliesRemaining lets the sender see their recipient is about to
  // run out (and be offered more) BEFORE the thread goes quiet — otherwise the
  // first sign of the cap is a reply that simply never arrives, which reads as
  // the recipient losing interest rather than hitting a wall.
  const recipientAllowance = recipientReplyAllowance(whisp.replyCreditsPurchased);
  res.json({
    whisp,
    trackingEvents,
    replies,
    recipientRepliesRemaining:
      recipientAllowance === null
        ? null
        : Math.max(0, recipientAllowance - replies.filter((r) => r.fromRecipient).length),
  });
});

// GET /api/whisps/:id/matches — aggregate-only Ghost Boost reach stats.
// Deliberately never a per-subscriber breakdown (unlike Group Whisper's
// sends detail) — the whole point of the matching queue is that the sender
// never learns who specifically it reached.
router.get("/:id/matches", requireAuth, async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  const user = await ensureUser(userId!, req);

  const whisp = await db
    .select()
    .from(whispsTable)
    .where(and(eq(whispsTable.id, req.params.id), eq(whispsTable.senderId, user.id), eq(whispsTable.deliveryMethod, "ghost_boost")))
    .then((r) => r[0]);

  if (!whisp) {
    res.status(404).json({ error: "Whisp not found" });
    return;
  }

  const stats = await getGhostBoostMatchStats(whisp.id);
  res.json(stats);
});

// DELETE /api/whisps/:id — soft delete. Hides the whisp (and its reply
// thread) from this sender's own list/detail/dashboard views, but never
// touches the row, its replies, or its tracking events: admins still see
// the full history for support purposes (routes/admin.ts never filters on
// deletedBySenderAt), and the Recipient's own public link keeps working,
// same as before this was deleted.
router.delete("/:id", requireAuth, async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  const user = await ensureUser(userId!, req);

  const whisp = await db
    .select()
    .from(whispsTable)
    .where(and(eq(whispsTable.id, req.params.id), eq(whispsTable.senderId, user.id), excludeMatchDeliveries(), excludeDeleted()))
    .then(r => r[0]);

  if (!whisp) {
    res.status(404).json({ error: "Whisp not found" });
    return;
  }

  await db.update(whispsTable).set({ deletedBySenderAt: new Date() }).where(eq(whispsTable.id, whisp.id));

  res.status(204).send();
});

// GET /api/whisps/:id/replies
router.get("/:id/replies", requireAuth, async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  const user = await ensureUser(userId!, req);

  const whisp = await db
    .select()
    .from(whispsTable)
    .where(and(eq(whispsTable.id, req.params.id), eq(whispsTable.senderId, user.id), excludeMatchDeliveries(), excludeDeleted()))
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
    .where(and(eq(whispsTable.id, req.params.id), eq(whispsTable.senderId, user.id), excludeMatchDeliveries(), excludeDeleted()))
    .then(r => r[0]);

  if (!whisp) {
    res.status(404).json({ error: "Whisp not found" });
    return;
  }

  const schema = z.object({
    replyText: z.string().min(1).max(300),
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
    // This route is requireAuth-gated to the whisp's own sender — the
    // caller IS the sender, full stop, so fromRecipient is never
    // client-controlled here (it used to accept an optional override,
    // which had no legitimate caller and let a sender mislabel their own
    // message as if it came from the recipient). The real recipient path is
    // the separate, unauthenticated POST /api/public/w/:token/reply below.
    fromRecipient: false,
  });

  const reply = await db.select().from(whispRepliesTable).where(eq(whispRepliesTable.id, id)).then(r => r[0]);
  res.status(201).json(reply);

  // Notify the recipient a new follow-up is waiting — mirrors the reveal-
  // request notification above; without this, a sender's follow-up was
  // silently invisible to the recipient unless they happened to reopen an
  // already-delivered link on their own. Same fire-and-forget, same
  // single-recipient-channel scoping (whisperChannel is null for
  // circle_drop/ghost_boost).
  if (whisp.whisperChannel) {
    void deliverWhisperLink(whisp, getPublicAppUrl(req), newReplyHookLine(), "reply_to_recipient");
  }
});

// POST /api/whisps/:id/reveal
router.post("/:id/reveal", requireAuth, async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  const user = await ensureUser(userId!, req);

  const whisp = await db
    .select()
    .from(whispsTable)
    .where(and(eq(whispsTable.id, req.params.id), eq(whispsTable.senderId, user.id), excludeMatchDeliveries(), excludeDeleted()))
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

  // Notify the recipient a reveal is pending — otherwise they'd only ever
  // find out by coincidentally reopening an already-delivered link. Only
  // whisper_link/group_whisper deliveries have a single recipient contact +
  // channel to notify on (whisperChannel is null for circle_drop/ghost_boost,
  // and deliverWhisperLink already no-ops safely if it's not set). Fire and
  // forget: whether this notification goes out shouldn't affect the reveal
  // request itself, already saved and returned above.
  if (whisp.whisperChannel) {
    void deliverWhisperLink(whisp, getPublicAppUrl(req), revealRequestHookLine(), "reveal_request");
  }
});

// PATCH /api/whisps/:id/reveal — called by the (unauthenticated) recipient,
// so the response must stay limited to what the public whisp page already
// shows. It must never return the full row: that would hand out senderId,
// recipientEmail/Phone, and everything else to anyone who has (or later
// obtains — a forwarded link, a leaked referrer, etc.) this whisp id.
// Unauthenticated + a real DB write, same category as every route in
// routes/public.ts — rate-limited the same way (see lib/rateLimit.ts's
// publicEndpointLimiter) so it isn't the one unauthenticated write endpoint
// in the app anyone can hammer without limit. Applied via a separate
// router.use() (rather than passed inline to router.patch()) for the same
// reason requireAuth is deliberately untyped (see lib/auth.ts's comment):
// express-rate-limit's own explicit RequestHandler typing, mixed into the
// same .patch() overload as the handler below, would widen this route's
// :id param inference to the generic ParamsDictionary for the whole chain.
router.use("/:id/reveal", publicEndpointLimiter);
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
