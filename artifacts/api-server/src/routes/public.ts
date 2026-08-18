import { Router } from "express";
import { db } from "@workspace/db";
import {
  whispsTable,
  whispRepliesTable,
  trackingEventsTable,
  usersTable,
  uploadedVideosTable,
} from "@workspace/db";
import { eq, and, count, isNull } from "drizzle-orm";
import { getAuth } from "@clerk/express";
import { randomUUID } from "crypto";
import { z } from "zod";
import { sendEmail, appreciationNotificationEmailHtml } from "../lib/email";
import { notifyUserPersisted } from "../lib/push";
import { getPublicAppUrl } from "../lib/publicUrl";
import { isExpired, MAX_REMINDERS } from "../lib/expiration";
import { downloadObject } from "../lib/objectStorage";
import { generateTakeawayAsync } from "../lib/aiTakeaway";
import { httpUrlString } from "../lib/safeUrl";
import { deriveVideoFields, detectPlatform, embedUrlFor } from "../lib/videoMeta";
import { recipientReplyAllowance, canRecipientWhispVideoBack } from "../lib/plans";

const router = Router();

// Explicit column list for every reply this UNAUTHENTICATED router hands to a
// recipient. Deliberately not `select()` (SELECT *): whisp_replies carries
// notifySenderAt and senderNotifiedAt, which are the machinery of the
// anti-correlation defense — a recipient's reply schedules the sender's
// notification 3/5/9 minutes out at random specifically so that, if the two
// people are physically together, the sender's phone doesn't buzz the instant
// the recipient hits send and give them away (see whisp_replies' own schema
// comment). Returning notifySenderAt to the recipient published the exact
// second that buzz would land, handing the countdown to the one party it
// exists to hide from; senderNotifiedAt then confirmed it had fired. Both are
// absent from the OpenAPI contract — they leaked purely because the query
// selected everything. This list is exactly what the shared ReplyThread
// component renders, nothing more.
const RECIPIENT_SAFE_REPLY_COLUMNS = {
  id: whispRepliesTable.id,
  whispId: whispRepliesTable.whispId,
  replyText: whispRepliesTable.replyText,
  fromRecipient: whispRepliesTable.fromRecipient,
  videoUrl: whispRepliesTable.videoUrl,
  videoTitle: whispRepliesTable.videoTitle,
  videoThumbnail: whispRepliesTable.videoThumbnail,
  videoEmbedUrl: whispRepliesTable.videoEmbedUrl,
  videoPlatform: whispRepliesTable.videoPlatform,
  moodTag: whispRepliesTable.moodTag,
  parentReplyId: whispRepliesTable.parentReplyId,
  createdAt: whispRepliesTable.createdAt,
} as const;

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

/**
 * Records that this whisp's recipient wanted to whisp a video back and
 * couldn't, so the sender can be told (deferred) that adding credit would
 * unlock it.
 *
 * Conditional on both columns still being null, in one UPDATE, so the write
 * itself is the guard: this is reachable from an unauthenticated route, and
 * without it a recipient tapping a locked button in a loop would drive a
 * notification per tap straight at the sender. Once notified it stays
 * notified — a second nudge for the same whisp isn't worth the abuse surface.
 */
async function recordVideoReplyRequest(whispId: string): Promise<void> {
  await db
    .update(whispsTable)
    .set({ videoReplyRequestNotifyAt: randomNotifyDelay() })
    .where(
      and(
        eq(whispsTable.id, whispId),
        isNull(whispsTable.videoReplyRequestNotifyAt),
        isNull(whispsTable.videoReplyRequestNotifiedAt),
      ),
    );
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

  // The reply thread. Without it, a recipient could send a reply but never
  // see it (or any sender follow-up) again on a later visit — every reply
  // looked like it vanished into a one-shot box instead of a real thread.
  const replies = await db
    .select(RECIPIENT_SAFE_REPLY_COLUMNS)
    .from(whispRepliesTable)
    .where(eq(whispRepliesTable.whispId, whisp.id))
    .orderBy(whispRepliesTable.createdAt);

  // Return only public-safe fields
  res.json({
    id: whisp.id,
    videoUrl: whisp.videoUrl,
    videoTitle: whisp.videoTitle,
    videoThumbnail: whisp.videoThumbnail,
    // Computed on read when the stored value is null. Embed URLs are a pure
    // function of the video URL, and whisps written before a platform became
    // embeddable have nothing stored — without this they'd keep bouncing the
    // recipient out to the original app forever. Cheap, and it self-heals
    // rather than needing a backfill.
    videoEmbedUrl: whisp.videoEmbedUrl ?? embedUrlFor(whisp.videoUrl, whisp.videoPlatform),
    // Whether THIS viewer may whisp a video back, so the page can gate the
    // affordance instead of letting someone compose one and then be refused.
    // Says nothing about the sender beyond "they have or haven't unlocked
    // this" — nothing identifying, and nothing about who holds an account.
    videoRepliesAllowed: canRecipientWhispVideoBack(!!getAuth(req).userId, whisp.replyCreditsPurchased),
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
    // How many anonymous replies this recipient has left, so the page can
    // warn them before they hit the wall rather than only after a rejected
    // send. Null means uncapped. Purely a count of their OWN replies — it
    // says nothing about the sender, so it leaks nothing across the
    // anonymity boundary.
    recipientRepliesRemaining: (() => {
      const allowance = recipientReplyAllowance(whisp.replyCreditsPurchased);
      if (allowance === null) return null;
      const used = replies.filter((r) => r.fromRecipient).length;
      return Math.max(0, allowance - used);
    })(),
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
// POST /api/public/w/:token/video-reply-request
//
// The recipient tapped "whisp a video back" and it's locked. Called at that
// moment rather than waiting for them to compose one and be refused, so the
// sender learns their recipient wanted to send something back while it's
// still worth acting on.
//
// Returns 204 whatever happens — including for an unknown token or a whisp
// that already recorded one. There is nothing here for a caller to learn: a
// different answer per case would turn this into an oracle for which tokens
// exist.
router.post("/w/:token/video-reply-request", async (req, res): Promise<void> => {
  const whisp = await db
    .select({ id: whispsTable.id, replyCreditsPurchased: whispsTable.replyCreditsPurchased })
    .from(whispsTable)
    .where(eq(whispsTable.publicToken, req.params.token))
    .then((r) => r[0]);

  // Only record a genuine block. If the sender has already unlocked it (or
  // the caller is signed in), there is nothing to ask them for.
  if (whisp && !canRecipientWhispVideoBack(!!getAuth(req).userId, whisp.replyCreditsPurchased)) {
    await recordVideoReplyRequest(whisp.id);
  }

  res.status(204).send();
});

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
  // A PATH, not an absolute URL. This value is persisted into the sender's
  // notification list and rendered as a clickable link — and when
  // PUBLIC_APP_URL is unset, getPublicAppUrl derives its host from a
  // client-supplied forwarded header, so an unauthenticated token holder
  // could write a durable https://attacker.example/whisps/<id> link straight
  // into the sender's in-app inbox. NotificationBell routes in-app anyway, so
  // a path is both safer and correct.
  const whispUrl = `/whisps/${whisp.id}`;
  if (eventType === "opened" && !whisp.openedAt) {
    await db.update(whispsTable).set({ status: "opened", openedAt: new Date() }).where(eq(whispsTable.id, whisp.id));
    if (!isMatchedFanout(whisp)) {
      void notifyUserPersisted(whisp.senderId, "Your whisp was opened 👀", "Someone just opened the link you sent.", whispUrl, "opened");
    }
    // Pressing play — or following the link out to the platform — is what
    // marks a whisp watched, on every platform. Only YouTube, Vimeo and native
    // uploads expose a player API that can report completion, so gating this
    // on watched_complete left a TikTok, Instagram, Facebook or X whisp
    // stuck at "opened" forever no matter what the recipient actually did.
    //
    // A watched_complete arriving later upgrades what the sender's timeline
    // says (it reads the raw tracking events) without touching the status, so
    // whichever event lands first owns the transition and the sender gets
    // exactly one "they watched it" notification rather than two buzzes for
    // one video.
  } else if ((eventType === "clicked" || eventType === "watched_complete") && !whisp.watchedAt) {
    await db
      .update(whispsTable)
      .set({ watchedAt: new Date(), ...(whisp.status === "replied" ? {} : { status: "watched" }) })
      .where(eq(whispsTable.id, whisp.id));
    if (!isMatchedFanout(whisp)) {
      void notifyUserPersisted(
        whisp.senderId,
        "They watched it 🎬",
        eventType === "watched_complete"
          ? "Your whisp was watched all the way through."
          : "Someone just played the video you sent.",
        whispUrl,
        "watched",
      );
    }
    // On the first watch signal rather than only on completion, because most
    // platforms can never report completion — and the unwatched-nudge sweep
    // (lib/takeawayScheduler.ts) skips anything with watchedAt set, so nothing
    // else would ever generate a takeaway for those whisps. Safe on both
    // events: it claims the whisp with a conditional UPDATE, so a second call
    // is a no-op (see lib/aiTakeaway.ts).
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
      // Allowlisted host, not just any http(s) URL. The sender CLICKS this
      // link from their thread, so an arbitrary host is the same
      // IP/geolocation leak the auto-loaded thumbnail is already guarded
      // against (see lib/videoMeta.ts's ALLOWED_HOSTS rationale and
      // deriveVideoFields below) — just one interaction removed. Without
      // this, a recipient could reply with a link to a logger they control
      // and learn the sender's IP, geo, and user-agent the moment it's
      // opened, which is precisely what this app's two-way anonymity is for.
      videoUrl: httpUrlString.refine((url) => detectPlatform(url) !== null, {
        message: "Video links must be from a supported platform",
      }).nullable().optional(),
      videoTitle: z.string().max(300).nullable().optional(),
      videoThumbnail: httpUrlString.nullable().optional(),
      videoEmbedUrl: httpUrlString.nullable().optional(),
      // Both capped like every sibling field — moodTag is persisted, so an
      // uncapped string let an anonymous caller store ~100 kB (the body-parser
      // limit) per reply.
      videoPlatform: z.string().max(50).nullable().optional(),
      moodTag: z.string().max(50).nullable().optional(),
      parentReplyId: z.string().max(64).nullable().optional(),
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
  const replyDerived = parsed.data.videoUrl ? deriveVideoFields(parsed.data.videoUrl, parsed.data.videoThumbnail) : null;

  // A parent must be a real message on THIS whisp. Storing an unchecked id
  // would let a caller point a reply at a message in someone else's thread,
  // and the quoted text is rendered to whoever opens this one — so an
  // unvalidated reference is a way to pull another conversation's content
  // into this page. Silently dropped rather than rejected: a stale parent
  // (the message was deleted with the whisp) should still post as an
  // ordinary reply instead of failing the send.
  let parentReplyId: string | null = null;
  if (parsed.data.parentReplyId) {
    const parent = await db
      .select({ id: whispRepliesTable.id })
      .from(whispRepliesTable)
      .where(and(eq(whispRepliesTable.id, parsed.data.parentReplyId), eq(whispRepliesTable.whispId, whisp.id)))
      .then((r) => r[0]);
    parentReplyId = parent?.id ?? null;
  }

  // Anonymous replies are capped per whisp; signing up lifts the cap
  // entirely. getAuth works here even though this route is unauthenticated —
  // clerkMiddleware runs globally (app.ts) — so a recipient who's created an
  // account and is signed in simply isn't subject to this at all.
  const { userId: replierClerkId } = getAuth(req);

  // Video replies are gated even when text replies are still allowed. Checked
  // server-side and not only in the UI: this route is unauthenticated, so the
  // client-side gate is a courtesy and this is the actual rule.
  if (parsed.data.videoUrl && !canRecipientWhispVideoBack(!!replierClerkId, whisp.replyCreditsPurchased)) {
    await recordVideoReplyRequest(whisp.id);
    res.status(403).json({
      error:
        "Whisping a video back needs a free account — or the sender can unlock it for you. Your text replies still work.",
      code: "video_reply_requires_membership",
    });
    return;
  }

  const allowance = replierClerkId ? null : recipientReplyAllowance(whisp.replyCreditsPurchased);

  let rejectedAtCap = false;
  let justReachedCap = false;

  // The cap check and the insert have to be ONE atomic unit. A plain
  // count-then-insert is the same race this codebase already fixed for the
  // Whisper Link limit and Ghost Boost credits (routes/whisps.ts): N
  // concurrent replies all read the same under-limit count, all pass, and all
  // insert — so the "3 replies" cap became "as many as fit inside the rate
  // limiter's window". Locking the whisp row serializes concurrent replies to
  // the same whisp for the life of the transaction, which is the narrowest
  // thing that actually makes the check hold.
  await db.transaction(async (tx) => {
    if (allowance !== null) {
      await tx.select({ id: whispsTable.id }).from(whispsTable).where(eq(whispsTable.id, whisp.id)).for("update");

      const used = await tx
        .select({ count: count() })
        .from(whispRepliesTable)
        .where(and(eq(whispRepliesTable.whispId, whisp.id), eq(whispRepliesTable.fromRecipient, true)))
        .then((r) => r[0]?.count ?? 0);

      if (used >= allowance) {
        rejectedAtCap = true;
        return;
      }
      // Whether THIS reply is the one that fills the allowance. The sender is
      // notified on that transition — not on subsequent rejected attempts,
      // which is where an earlier version of this got it wrong: `used` stays
      // pinned at the allowance once full, so a "notify once" guard written as
      // `used === allowance` inside the rejection branch was true on *every*
      // blocked attempt, turning a loop of rejected POSTs into an unbounded
      // notification/push flood against the sender.
      justReachedCap = used + 1 >= allowance;
    }

    await tx.insert(whispRepliesTable).values({
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
      parentReplyId,
      notifySenderAt,
    });

    await tx.update(whispsTable).set({ status: "replied" }).where(eq(whispsTable.id, whisp.id));
  });

  if (rejectedAtCap) {
    // 403 with an explicit code so the page can show the real reason
    // ("this conversation is full") instead of a generic failure, and offer
    // signing up as the way to keep going.
    res.status(403).json({
      error: "You've used all the anonymous replies on this whisp. Sign up to keep the conversation going.",
      code: "reply_limit_reached",
    });
    return;
  }

  if (justReachedCap && !isMatchedFanout(whisp)) {
    void notifyUserPersisted(
      whisp.senderId,
      "They've run out of replies 🔒",
      "The person you whisped can't reply again unless you add more replies, or they sign up.",
      `/whisps/${whisp.id}`,
      "reply_limit",
    );
  }

  const reply = await db
    .select(RECIPIENT_SAFE_REPLY_COLUMNS)
    .from(whispRepliesTable)
    .where(eq(whispRepliesTable.id, id))
    .then((r) => r[0]);
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
      `/whisps/${whisp.id}`,
      "appreciation",
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
