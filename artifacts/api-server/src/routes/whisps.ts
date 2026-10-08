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
  circleCommentsTable,
  circlePostLikesTable,
} from "@workspace/db";
import { eq, ne, and, sql, isNull, isNotNull, or, lt, lte, gt, gte, count, desc, notInArray } from "drizzle-orm";
import { randomUUID } from "crypto";
import { z } from "zod";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { requireAuth } from "../lib/auth";
import { ensureUser } from "../lib/ensureUser";
import { getPublicAppUrl } from "../lib/publicUrl";
import { deliverWhisperLink, findVerifiedRecipient, findVerifiedRecipientByEmail } from "../lib/deliver";
import { revealRequestHookLine, newReplyHookLine } from "../lib/copy";
import { categorizeWhispAsync } from "../lib/categorizeWhisp";
import { moderateWhispAsync } from "../lib/moderation";
import { needsDemographics } from "../lib/demographics";
import { computeExpiresAt, isExpired, MAX_SCHEDULE_DAYS } from "../lib/expiration";
import { MAX_SCHEDULE_DAYS_WITH_UPLOAD } from "../lib/uploads";
import { whisperLinkLimitFor, GHOST_BOOST_COST_USD, GHOST_BOOST_ENABLED, recipientReplyAllowance } from "../lib/plans";
import { createWhispLimiter, noteSuggestionLimiter, conciergeLimiter, publicEndpointLimiter } from "../lib/rateLimit";
import { getGhostBoostMatchStats } from "../lib/matching";
import { generateNoteSuggestions } from "../lib/noteSuggestions";
import { httpUrlString } from "../lib/safeUrl";
import { deriveVideoFields, embedUrlFor, detectPlatform } from "../lib/videoMeta";
import { runConcierge, MAX_SITUATION_LENGTH } from "../lib/concierge";
import { safeAssignOrGetSenderHandle } from "../lib/whispSenderHandle";
import { hasSmsConsent, recordSmsConsent } from "../lib/smsConsent";
import { disabledChannelError } from "../lib/messagingChannels";
import { logger } from "../lib/logger";
import { downloadObject } from "../lib/objectStorage";

const router = Router();

// Per-account limits on the two sender actions that each put a real
// email/SMS/WhatsApp in the RECIPIENT's hands (via deliverWhisperLink) —
// without them a sender could flood someone's phone through our verified
// number. Keyed by Clerk user (requireAuth always runs first). Defined here
// rather than in lib/rateLimit.ts since they guard exactly these two routes.
function authUserKey(req: any): string {
  return getAuth(req).userId ?? ipKeyGenerator(req.ip ?? "");
}
const senderFollowUpLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: authUserKey,
});
const revealRequestLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: authUserKey,
});

// At most one EXTERNAL "new follow-up" notice per whisp per window (see
// whisps.recipientReplyNotifiedAt); further follow-ups inside it only notify
// in-app.
const RECIPIENT_REPLY_NOTIFY_COOLDOWN_MS = 15 * 60 * 1000;

// Blind Circle posts have ONE thread shared by every anonymous viewer (see
// routes/public.ts), so a poster's follow-up, guess confirmation, or reveal
// request on it would be published to everyone who opens the post, not
// delivered to one person. Those person-to-person actions belong on a
// private circle_dm conversation instead.
const CIRCLE_DROP_PRIVATE_ACTION_ERROR =
  "Blind Circle posts are public — follow-ups, guess reactions and reveals aren't available on them. Use a private conversation instead.";

const NOT_YET_DELIVERED_ERROR = "This whisp hasn't been delivered yet — you can follow up or reveal once it's sent.";

// Statuses a matched RECIPIENT must never see: recipientUserId is set at
// insert time even for a scheduled send, so without this the recipient's
// Received box (and its publicToken) would show a whisp before it's due, or
// one the sender cancelled by deleting it before it went out.
const RECIPIENT_HIDDEN_STATUSES = ["scheduled", "cancelled"];

// Everything a recipient-side whisp query must also require: actually
// delivered (or delivery attempted), and not taken down by a moderator — a
// takedown has to reach the in-app Received box too, not just public pages.
function recipientVisible() {
  return and(notInArray(whispsTable.status, RECIPIENT_HIDDEN_STATUSES), isNull(whispsTable.removedByAdminAt));
}

// The one definition of "a whisp this user RECEIVED" — shared by GET
// /?box=received, the Archived box's recipient half, and
// /received-unread-count, so the nav badge can never count a row the list
// doesn't show. Excludes a whisp the caller sent to their OWN email/phone:
// it already sits in their Sent box, and toWhispResponse resolves it as the
// sender's (viewerRole "sender"), so in Received it linked to the sender's
// detail page — which never records an open — and stayed "new" forever.
function receivedBy(userId: string) {
  return and(eq(whispsTable.recipientUserId, userId), ne(whispsTable.senderId, userId), recipientVisible());
}

// "Unread" for a received whisp: never opened AND still openable. An
// expired whisp can't be opened any more — POST /public/w/:token/track
// deliberately ignores it, so openedAt never gets set — which left one the
// recipient didn't reach within the 48h window counting as unread forever,
// with nothing they could do to clear it. isReceivedUnread is the same rule
// for one already-loaded row (toWhispResponse's `unread`), kept beside the
// SQL so the two can't drift.
function receivedUnread() {
  return and(isNull(whispsTable.openedAt), or(isNull(whispsTable.expiresAt), gt(whispsTable.expiresAt, new Date())));
}
function isReceivedUnread(whisp: { openedAt: Date | null; expiresAt: Date | null }): boolean {
  return !whisp.openedAt && !isExpired(whisp.expiresAt);
}

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

// A moderation takedown, as routes/public.ts's loadLiveWhisp defines it: the
// whisp itself, or the Circle post a circle_dm thread was cloned from (the
// clone carries its own copy of the video reference). Unlike the two
// filters above, the sender keeps SEEING such a whisp in their own lists —
// this only decides whether the video itself is still offered to them.
async function isTakenDown(whisp: { removedByAdminAt: Date | null; originCircleWhispId: string | null }): Promise<boolean> {
  if (whisp.removedByAdminAt) return true;
  if (!whisp.originCircleWhispId) return false;
  const origin = await db
    .select({ removedByAdminAt: whispsTable.removedByAdminAt })
    .from(whispsTable)
    .where(eq(whispsTable.id, whisp.originCircleWhispId))
    .then((r) => r[0]);
  return !!origin?.removedByAdminAt;
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

// Fields a matched RECIPIENT (or any non-sender) may see — an explicit
// allowlist rather than a denylist, so a column added to whisps later stays
// out of the recipient's view until someone deliberately puts it here.
// Notably absent: senderId (handled below), recipientUserId, the raw
// pin/archive columns, groupSendId/whisperGroupId (two recipients of the same
// Group Whisper could compare them and learn one person sent both "separate"
// anonymous whisps), uploadedVideoId (the sender's Media Library id — same
// cross-recipient linking problem), conciergeRequestId, deletedBySenderAt,
// boostSpendUsd/replyCreditsPurchased, removedByAdminAt/postedBy, and the
// notification-deferral bookkeeping (videoReplyRequestNotify*, which would
// reveal the exact second the sender's phone buzzes — same reasoning as
// whisp_replies.notifySenderAt; recipientReplyNotifiedAt).
const RECIPIENT_VISIBLE_FIELDS = [
  "id",
  "videoUrl",
  "videoTitle",
  "videoThumbnail",
  "videoEmbedUrl",
  "videoStartSeconds",
  "videoEndSeconds",
  "videoPlatform",
  "videoTranscript",
  "deliveryMethod",
  "whisperChannel",
  "circleId",
  "recipientEmail",
  "recipientPhone",
  "anonymousNote",
  "senderAlias",
  "moodTag",
  "status",
  "publicToken",
  "scheduledAt",
  "deliveredAt",
  "openedAt",
  "watchedAt",
  "revealRequested",
  "revealAccepted",
  "appreciationResponse",
  "appreciationRespondedAt",
  "expiresAt",
  "aiTakeaway",
  "aiTakeawayStatus",
  "createdAt",
] as const satisfies readonly (keyof typeof whispsTable.$inferSelect)[];

// ANTI-ENUMERATION: every whisp a user-facing route returns goes through
// here. A sender reading recipientUserId straight off their own sent whisps
// would learn whether an arbitrary email/phone belongs to a verified Blind
// Whisper account for free; the raw pin/archive pairs would leak whether the
// OTHER party pinned or archived their own copy; senderId reaching a matched
// RECIPIENT (box=received/archived) would hand them the sender's real
// account id, breaking the exact anonymity guarantee Whisper Link is built
// around — the same thing PATCH /:id/reveal deliberately withholds even when
// a reveal is accepted, and that routes/public.ts's GET /w/:token allowlists
// around by construction. viewerRole/pinned/archived only ever reveal facts
// about the CALLER's own side. Same reasoning as routes/textWhisps.ts's
// toResponse.
async function toWhispResponse(whisp: typeof whispsTable.$inferSelect, viewerId: string) {
  const {
    recipientUserId,
    senderPinnedAt,
    senderArchivedAt,
    recipientPinnedAt,
    recipientArchivedAt,
    videoReplyRequestNotifyAt,
    videoReplyRequestNotifiedAt,
    recipientReplyNotifiedAt,
    senderId,
    ...senderVisible
  } = whisp;
  const viewerRole: "sender" | "recipient" | null =
    senderId === viewerId ? "sender" : recipientUserId === viewerId ? "recipient" : null;
  const callerRelative = {
    viewerIsRecipient: recipientUserId === viewerId,
    viewerRole,
    pinned: viewerRole === "sender" ? !!senderPinnedAt : viewerRole === "recipient" ? !!recipientPinnedAt : false,
    archived: viewerRole === "sender" ? !!senderArchivedAt : viewerRole === "recipient" ? !!recipientArchivedAt : false,
    // The Received tab's "New" marker and badge read this instead of
    // re-deriving it from openedAt client-side, so they always agree with
    // /received-unread-count (see isReceivedUnread).
    unread: viewerRole === "recipient" && isReceivedUnread(whisp),
  };

  if (viewerRole === "sender") {
    // contentRemoved: a moderator took this down (see isTakenDown). The
    // sender's own copy stays listed — it's their history — but the UI
    // stops offering the video itself. A recipient never sees one at all.
    return { ...senderVisible, senderId, senderHandle: null, contentRemoved: await isTakenDown(whisp), ...callerRelative };
  }

  const recipientView: Record<string, unknown> = {};
  for (const key of RECIPIENT_VISIBLE_FIELDS) recipientView[key] = whisp[key];
  const senderHandle = viewerRole === "recipient" ? await safeAssignOrGetSenderHandle(senderId, viewerId) : null;
  return { ...recipientView, senderId: null, senderHandle, ...callerRelative };
}

// Loads a whisp this user has SOME role on (sender or matched recipient) —
// shared by the pin/archive toggle endpoints below, which both need to know
// which pair of columns (sender* vs recipient*) applies to this caller.
async function loadWhispForViewer(id: string, userId: string) {
  const whisp = await db.select().from(whispsTable).where(eq(whispsTable.id, id)).then((r) => r[0]);
  if (!whisp) return null;
  if (whisp.senderId === userId) return { whisp, role: "sender" as const };
  // Same visibility rule as the Received box — a recipient can't act on a
  // whisp that hasn't (or will never) reach them, or that was taken down.
  if (whisp.recipientUserId === userId && !RECIPIENT_HIDDEN_STATUSES.includes(whisp.status) && !whisp.removedByAdminAt) {
    return { whisp, role: "recipient" as const };
  }
  return null;
}

// GET /api/whisps — ?box=sent (default) is what this sender sent; ?box=received
// is what other Whisperers have sent TO this user (see whisps.recipientUserId);
// ?box=archived is whichever of those this user archived from either side,
// combined into one list (see whisps.senderArchivedAt/recipientArchivedAt).
// Received items are never affected by the sender's own soft-delete
// (excludeDeleted() only ever applies to the box this user sent) — except
// that a whisp which hasn't gone out yet (scheduled) or never will
// (cancelled), or that a moderator took down, never shows as received at all
// (see recipientVisible()). Ghost
// Boost's stranger-matched deliveries never appear as "received" — a
// recipientUserId is only ever set for a whisper_link/group_whisper send.
router.get("/", requireAuth, async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  const user = await ensureUser(userId!, req);

  const statusFilter = req.query.status as string | undefined;
  const box = req.query.box === "received" ? "received" : req.query.box === "archived" ? "archived" : "sent";

  let whereClause;
  let orderClause;
  if (box === "received") {
    whereClause = and(
      receivedBy(user.id),
      isNull(whispsTable.recipientArchivedAt),
      statusFilter ? eq(whispsTable.status, statusFilter) : undefined,
    );
    orderClause = sql`${whispsTable.recipientPinnedAt} IS NOT NULL DESC, ${whispsTable.createdAt} DESC`;
  } else if (box === "archived") {
    whereClause = or(
      and(eq(whispsTable.senderId, user.id), isNotNull(whispsTable.senderArchivedAt), excludeMatchDeliveries(), excludeDeleted()),
      and(receivedBy(user.id), isNotNull(whispsTable.recipientArchivedAt)),
    );
    // Sorted by the CALLER's own side only: GREATEST() over both archive
    // columns let the other party's archive time reorder this user's list,
    // and it ignored this user's own pins, which the Archived tab offers
    // the same as the other two.
    const callerIsSender = sql`${whispsTable.senderId} = ${user.id}`;
    orderClause = sql`(CASE WHEN ${callerIsSender} THEN ${whispsTable.senderPinnedAt} ELSE ${whispsTable.recipientPinnedAt} END) IS NOT NULL DESC, (CASE WHEN ${callerIsSender} THEN ${whispsTable.senderArchivedAt} ELSE ${whispsTable.recipientArchivedAt} END) DESC`;
  } else {
    whereClause = and(
      eq(whispsTable.senderId, user.id),
      excludeMatchDeliveries(),
      excludeDeleted(),
      isNull(whispsTable.senderArchivedAt),
      statusFilter ? eq(whispsTable.status, statusFilter) : undefined,
    );
    orderClause = sql`${whispsTable.senderPinnedAt} IS NOT NULL DESC, ${whispsTable.createdAt} DESC`;
  }

  const whisps = await db.select().from(whispsTable).where(whereClause).orderBy(orderClause);

  res.json(await Promise.all(whisps.map((w) => toWhispResponse(w, user.id))));
});

// GET /api/whisps/received-unread-count — a lightweight poll target for the
// "My Whisps" nav badge, built from the same receivedBy() predicate as GET
// /?box=received (plus not archived) but counting rather than fetching full
// rows. "Unread" is receivedUnread(): openedAt IS NULL — the same flag
// routes/public.ts's hasOpenedBefore reads, so the badge clears the moment
// the recipient actually opens the whisp, not when some separate
// notification gets dismissed — and not yet expired.
router.get("/received-unread-count", requireAuth, async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  const user = await ensureUser(userId!, req);

  const row = await db
    .select({ count: count() })
    .from(whispsTable)
    .where(
      and(receivedBy(user.id), isNull(whispsTable.recipientArchivedAt), receivedUnread()),
    )
    .then((r) => r[0]);

  res.json({ unreadCount: row?.count ?? 0 });
});

// POST /api/whisps/:id/pin — toggles pin for whichever role (sender or
// matched recipient) the caller has on this whisp. Pinning only affects
// sort order within whichever list it's already showing in; it never moves
// a whisp between Sent/Received/Archive on its own.
router.post("/:id/pin", requireAuth, async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  const user = await ensureUser(userId!, req);

  const loaded = await loadWhispForViewer(req.params.id, user.id);
  if (!loaded) {
    res.status(404).json({ error: "Whisp not found" });
    return;
  }

  const column = loaded.role === "sender" ? whispsTable.senderPinnedAt : whispsTable.recipientPinnedAt;
  const currentlyPinned = loaded.role === "sender" ? !!loaded.whisp.senderPinnedAt : !!loaded.whisp.recipientPinnedAt;
  const nextValue = currentlyPinned ? null : new Date();

  await db.update(whispsTable).set({ [loaded.role === "sender" ? "senderPinnedAt" : "recipientPinnedAt"]: nextValue }).where(eq(whispsTable.id, loaded.whisp.id));
  res.json({ pinned: !currentlyPinned });
});

// POST /api/whisps/:id/archive — toggles archive for whichever role the
// caller has, same shape as the pin endpoint. Reversible: calling it again
// un-archives, moving the whisp back into that role's Sent/Received list.
router.post("/:id/archive", requireAuth, async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  const user = await ensureUser(userId!, req);

  const loaded = await loadWhispForViewer(req.params.id, user.id);
  if (!loaded) {
    res.status(404).json({ error: "Whisp not found" });
    return;
  }

  const currentlyArchived = loaded.role === "sender" ? !!loaded.whisp.senderArchivedAt : !!loaded.whisp.recipientArchivedAt;
  const nextValue = currentlyArchived ? null : new Date();

  await db.update(whispsTable).set({ [loaded.role === "sender" ? "senderArchivedAt" : "recipientArchivedAt"]: nextValue }).where(eq(whispsTable.id, loaded.whisp.id));
  res.json({ archived: !currentlyArchived });
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
    res.status(428).json({ error: "Please confirm your gender, age range, and preferred language before sending your first whisp.", code: "demographics_required" });
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
      videoPlatform: z.string().max(50).nullable().optional(),
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
      // Bounded generously above every composer's own maxLength (the Circle
      // composer allows a 500-char note, 200-char alias) — these are stored
      // and rendered to other people, so they can't be unbounded.
      anonymousNote: z.string().max(1000).nullable().optional(),
      senderAlias: z.string().max(200).nullable().optional(),
      moodTag: z.string().max(50).nullable().optional(),
      scheduledAt: z.string().max(64).nullable().optional(),
      // Set by the composer when the video and/or note came from the "Not
      // sure what to send?" concierge — see the ownership check below.
      // Purely an analytics correlation, never trusted for anything else.
      conciergeRequestId: z.string().nullable().optional(),
      // Mirrors the required, unchecked-by-default checkbox SendWhisp.tsx
      // shows right where a Sender enters an SMS recipient's phone number
      // (see SmsTerms.tsx's "live example"). Enforced HERE, not just as a
      // disabled Send button client-side — without a server-side check, a
      // direct API call could SMS anyone with no opt-in confirmation at
      // all, which is exactly the evidence Twilio's A2P 10DLC review
      // requires to actually exist.
      smsConsentConfirmed: z.boolean().nullable().optional(),
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

  if (data.deliveryMethod === "ghost_boost" && !GHOST_BOOST_ENABLED) {
    res.status(403).json({ error: "Ghost Boost is temporarily unavailable." });
    return;
  }

  // Circle Drop and Ghost Boost viewers are anonymous TO the sender — unlike
  // a Whisper Link, where the sender picked the recipient. An arbitrary
  // https link there is a tracking pixel: every viewer's browser/app fetches
  // it, logging their IP/User-Agent on the sender's server. So these only
  // accept a recognized video platform (lib/videoMeta.ts ALLOWED_HOSTS) or
  // the sender's own upload.
  if (
    (data.deliveryMethod === "circle_drop" || data.deliveryMethod === "ghost_boost") &&
    !data.uploadedVideoId &&
    detectPlatform(data.videoUrl!) === null
  ) {
    res.status(400).json({
      error: "Blind Circle and Ghost Boost posts need a YouTube, TikTok, Instagram, Facebook, Vimeo or X link, or an uploaded video.",
    });
    return;
  }

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
  // An unparseable date must be rejected HERE, before any quota/credit is
  // spent: Invalid Date fails the isScheduled check below (NaN > now is
  // false), skips the window validation, and then blows up the insert's
  // toISOString() — after the sender was already charged a link/credit.
  if (scheduledDate && Number.isNaN(scheduledDate.getTime())) {
    res.status(400).json({ error: "That schedule date isn't valid." });
    return;
  }
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
    // The days-out cap alone isn't enough for library re-use: media uploaded
    // six days ago phases out tomorrow, so measure against the upload's OWN
    // expiry too — the send must land early enough that the recipient's full
    // 48-hour window fits before the bytes are deleted.
    if (uploadedVideo?.expiresAt && scheduledDate!.getTime() > uploadedVideo.expiresAt.getTime() - 48 * 60 * 60 * 1000) {
      res.status(400).json({
        error: "That upload is close to phasing out — schedule it sooner, or re-upload the video for a fresh 7-day window.",
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
    // SMS/WhatsApp launch switch (lib/messagingChannels.ts). Covers scheduled
    // sends too — they're created through this same route — so nothing new
    // can be queued for a channel that's off.
    const channelOff = disabledChannelError(data.whisperChannel);
    if (channelOff) {
      res.status(400).json(channelOff);
      return;
    }
    // WhatsApp isn't carrier-regulated under A2P 10DLC the same way SMS is
    // — same carve-out SendWhisp.tsx's own requiresSmsConsent uses — so only
    // an actual SMS send requires this. Consent is once-per-recipient: an
    // affirmative checkbox on THIS send, OR a stored consent from a prior
    // send to the same number, satisfies it (see lib/smsConsent.ts).
    if (data.whisperChannel === "sms" && data.recipientPhone) {
      const alreadyConsented = data.smsConsentConfirmed || (await hasSmsConsent(user.id, data.recipientPhone));
      if (!alreadyConsented) {
        res.status(400).json({ error: "Please confirm you have this person's permission to receive a text from you.", code: "sms_consent_required" });
        return;
      }
      // Persist a fresh attestation so future sends to this number skip the
      // checkbox. Idempotent + best-effort (see recordSmsConsent) — never
      // gates the send on the write landing.
      if (data.smsConsentConfirmed) void recordSmsConsent(user.id, data.recipientPhone);
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

    // Window rollover is its own conditional UPDATE, decided by the database
    // rather than the (possibly stale) `user` row read at the top of this
    // request: previously the reset branch blindly wrote whisperLinksUsed = 1,
    // so N concurrent sends right at the boundary each "reset" and each sent
    // — blowing past the cap. Now only one request can win the rollover, and
    // every request (that one included) then goes through the guarded
    // increment below.
    await db
      .update(usersTable)
      .set({ whisperLinksUsed: 0, whisperLinksResetAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000) })
      .where(
        and(
          eq(usersTable.id, user.id),
          or(isNull(usersTable.whisperLinksResetAt), lte(usersTable.whisperLinksResetAt, now)),
        ),
      );

    if (limit === null) {
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

  // Matched BEFORE insert (not just at delivery time) so recipientUserId is
  // persisted on the row itself — that's what lets a signed-in recipient see
  // this whisp in their own "Received" list (GET /?box=received) rather than
  // only ever being reachable via the delivered link. Only meaningful for a
  // whisper_link addressed to a specific person; circle_drop/ghost_boost
  // have no single recipient identity to match. lib/deliver.ts's
  // deliverWhisperLink does its own equivalent lookup at send time for
  // delivery routing — this is a second, cheap indexed lookup, not a shared
  // code path, since that function also serves scheduled/reminder callers
  // that already have a persisted whisp row and don't need to recompute it.
  let recipientUserId: string | null = null;
  if (data.deliveryMethod === "whisper_link") {
    if (data.whisperChannel === "email" && data.recipientEmail) {
      recipientUserId = (await findVerifiedRecipientByEmail(data.recipientEmail))?.id ?? null;
    } else if ((data.whisperChannel === "sms" || data.whisperChannel === "whatsapp") && data.recipientPhone) {
      recipientUserId = (await findVerifiedRecipient(data.recipientPhone))?.id ?? null;
    }
  }

  const id = randomUUID();
  const publicToken = randomUUID().replace(/-/g, "");

  // An uploaded video is never itself dereferenced by videoUrl — playback
  // goes through /public/w/:token/media instead — but the column is NOT
  // NULL, so a synthetic, unnavigable marker fills it.
  const effectiveVideoUrl = uploadedVideo ? `upload:${uploadedVideo.id}` : data.videoUrl!;
  // Never fall back to the upload's original filename: it's whatever the
  // file was called on the sender's device ("IMG_2041.MOV", "for jess from
  // mike.mp4") and would be shown publicly as the video's title.
  const effectiveVideoTitle = data.videoTitle ?? null;
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
    recipientUserId,
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

  // An immediate send near the end of an upload's 7-day retention would
  // otherwise have its bytes deleted mid-way through the recipient's 48-hour
  // window (retention sweeps purely on uploadedVideos.expiresAt). Extend the
  // media's life to cover the whisp's own expiry, plus an hour of slack.
  if (uploadedVideo?.expiresAt && !isScheduled && !isGhostBoost) {
    const needUntil = new Date(Date.now() + 49 * 60 * 60 * 1000);
    if (uploadedVideo.expiresAt.getTime() < needUntil.getTime()) {
      await db.update(uploadedVideosTable).set({ expiresAt: needUntil }).where(eq(uploadedVideosTable.id, uploadedVideo.id));
    }
  }

  // Read back and respond before kicking off the fire-and-forget delivery
  // send below — deliverWhisperLink awaits the actual Twilio/Resend call and
  // (for a failed initial send) updates this same row's status, so building
  // the response from a fresh select afterward would race it. The response
  // reflects the whisp as inserted (status 'delivered' = "attempted
  // delivery"); a transport failure discovered moments later is visible via
  // GET, not this response, same as the scheduled-send and reminder paths.
  const whisp = await db.select().from(whispsTable).where(eq(whispsTable.id, id)).then(r => r[0]!);
  res.status(201).json(await toWhispResponse(whisp, user.id));

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
    // Through toWhispResponse like every other whisp list — raw rows carried
    // recipientUserId (an account-existence oracle for the sender) and the
    // recipient's own pin/archive state.
    recentWhisps: await Promise.all(allWhisps.slice(0, 5).map((w) => toWhispResponse(w, user.id))),
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

  // Explicit columns: userAgent and ipHash belong to the RECIPIENT's device
  // and network — the sender gets the funnel (what happened, when), never a
  // device fingerprint or a hash they could use to tell whether two whisps
  // were opened from the same place.
  const trackingEvents = await db
    .select({
      id: trackingEventsTable.id,
      whispId: trackingEventsTable.whispId,
      eventType: trackingEventsTable.eventType,
      createdAt: trackingEventsTable.createdAt,
    })
    .from(trackingEventsTable)
    .where(eq(trackingEventsTable.whispId, whisp.id))
    .orderBy(sql`${trackingEventsTable.createdAt} ASC`);

  // Loading this page IS reading the recipient's side of the conversation —
  // same "opening the chat" read receipt as the recipient gets on the public
  // page (see routes/public.ts's GET /w/:token), mirrored for the other
  // direction. Marked before the select below so this response already
  // reflects it; scoped to fromRecipient=true (the recipient authored it)
  // and still-null readAt so re-visiting an already-read thread is a no-op.
  await db
    .update(whispRepliesTable)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(whispRepliesTable.whispId, whisp.id),
        eq(whispRepliesTable.fromRecipient, true),
        isNull(whispRepliesTable.readAt)
      )
    );

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

  // Engagement data a poster can otherwise never see: how many anonymous
  // circle viewers watched/liked/commented on their post, and every private
  // conversation started from it (see routes/public.ts's POST
  // /w/:token/circle-dm/start). Skipped for every other delivery method —
  // "how many people watched" only makes sense for a post with more than
  // one possible viewer.
  let viewCount = 0;
  let likeCount = 0;
  let comments: Array<{
    id: string;
    commentText: string;
    parentCommentId: string | null;
    isPoster: boolean;
    createdAt: Date;
  }> = [];
  let circleConversations: Array<{ id: string; publicToken: string; createdAt: Date }> = [];
  if (whisp.deliveryMethod === "circle_drop") {
    // "opened" fires once per real page load (see PublicWhispPage.tsx's
    // hasTrackedOpen), so counting those events is the same "how many
    // separate visits" proxy views everywhere else on the internet use —
    // not a count of unique people (nothing here tracks visitor identity),
    // but a real, honest engagement signal all the same.
    viewCount = trackingEvents.filter((e) => e.eventType === "opened").length;

    const [likeRow] = await db.select({ count: count() }).from(circlePostLikesTable).where(eq(circlePostLikesTable.whispId, whisp.id));
    likeCount = likeRow?.count ?? 0;

    comments = await db
      .select({
        id: circleCommentsTable.id,
        commentText: circleCommentsTable.commentText,
        parentCommentId: circleCommentsTable.parentCommentId,
        isPoster: circleCommentsTable.isPoster,
        createdAt: circleCommentsTable.createdAt,
      })
      .from(circleCommentsTable)
      .where(eq(circleCommentsTable.whispId, whisp.id))
      .orderBy(circleCommentsTable.createdAt);

    circleConversations = await db
      .select({ id: whispsTable.id, publicToken: whispsTable.publicToken, createdAt: whispsTable.createdAt })
      .from(whispsTable)
      .where(and(eq(whispsTable.originCircleWhispId, whisp.id), eq(whispsTable.senderId, user.id)))
      .orderBy(desc(whispsTable.createdAt));
  }

  // recipientUserId (and the recipient's own pin/archive columns) are
  // stripped for the same anti-enumeration reason toWhispResponse strips
  // them in GET / — a sender reading recipientUserId straight off their own
  // whisp's detail page would learn whether the email/phone they sent to
  // belongs to a verified Blind Whisper account, and the recipient's
  // pin/archive state isn't the sender's to see. This route is already
  // scoped to the sender (never the recipient), so pinned/archived below
  // always reflect the sender's own senderPinnedAt/senderArchivedAt.
  const { recipientUserId: _recipientUserId, senderPinnedAt, senderArchivedAt, recipientPinnedAt: _recipientPinnedAt, recipientArchivedAt: _recipientArchivedAt, recipientReplyNotifiedAt: _recipientReplyNotifiedAt, ...senderSafeWhisp } = whisp;

  res.json({
    // Same read-time embed fill-in as the public page (see routes/public.ts),
    // so the sender previewing their own whisp sees exactly what the
    // recipient will.
    whisp: {
      ...senderSafeWhisp,
      videoEmbedUrl: whisp.videoEmbedUrl ?? embedUrlFor(whisp.videoUrl, whisp.videoPlatform),
      pinned: !!senderPinnedAt,
      archived: !!senderArchivedAt,
      contentRemoved: await isTakenDown(whisp),
    },
    trackingEvents,
    replies,
    recipientRepliesRemaining:
      recipientAllowance === null
        ? null
        : Math.max(0, recipientAllowance - replies.filter((r) => r.fromRecipient).length),
    viewCount,
    likeCount,
    comments,
    circleConversations,
  });
});

// GET /api/whisps/:id/media (+ /thumbnail) — the SENDER's own way back to an
// uploaded video they sent. The recipient-facing /public/w/:token/media is
// gated on everything the recipient's link is: it 410s once the whisp's 48h
// window lapses and 404s while it's still scheduled — so from the Sent tab
// the sender lost their own clip the moment the recipient's link expired,
// even though the bytes were still in their Media Library. Scoped by sender
// ownership instead, and deliberately NOT by whisp expiry, archive or status.
// Still refused for a moderation takedown (incl. a circle_dm cloned from a
// removed post, same as loadLiveWhisp), and still 410s once the upload
// itself was phased out by lib/mediaRetentionScheduler.ts or deleted from
// the library — that's a storage policy the owner was already notified of,
// not something this route can undo. Owner-only + requireAuth, so the
// frontend fetches it with its bearer header (useCredentialedMediaUrl /
// Thumbnail) rather than a bare <video src>/<img src>.
async function loadSenderUpload(id: string, userId: string) {
  const whisp = await db
    .select()
    .from(whispsTable)
    .where(and(eq(whispsTable.id, id), eq(whispsTable.senderId, userId), excludeMatchDeliveries(), excludeDeleted()))
    .then((r) => r[0]);
  if (!whisp?.uploadedVideoId || (await isTakenDown(whisp))) return { status: 404 as const };

  const media = await db
    .select()
    .from(uploadedVideosTable)
    .where(eq(uploadedVideosTable.id, whisp.uploadedVideoId))
    .then((r) => r[0]);
  if (!media) return { status: 404 as const };
  if (media.status !== "ready") return { status: 410 as const };
  return { status: 200 as const, media };
}

router.get("/:id/media", requireAuth, async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  const user = await ensureUser(userId!, req);

  const result = await loadSenderUpload(req.params.id, user.id);
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

router.get("/:id/media/thumbnail", requireAuth, async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  const user = await ensureUser(userId!, req);

  const result = await loadSenderUpload(req.params.id, user.id);
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

  // A still-scheduled whisp is cancelled outright, in the same statement so
  // it can't race lib/scheduler.ts's claim: the recipient's view of a
  // DELIVERED whisp is deliberately unaffected by a sender delete (see
  // above), but one that never went out must never reach them at all.
  await db
    .update(whispsTable)
    .set({
      deletedBySenderAt: new Date(),
      status: sql`CASE WHEN ${whispsTable.status} = 'scheduled' THEN 'cancelled' ELSE ${whispsTable.status} END`,
    })
    .where(eq(whispsTable.id, whisp.id));

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
router.post("/:id/replies", requireAuth, senderFollowUpLimiter, async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  const user = await ensureUser(userId!, req);

  // senderFollowUpLimiter's explicit RequestHandler typing widens this
  // chain's params to the generic ParamsDictionary (see lib/auth.ts's
  // requireAuth comment) — cast back to the string `:id` actually is.
  const whisp = await db
    .select()
    .from(whispsTable)
    .where(and(eq(whispsTable.id, req.params.id as string), eq(whispsTable.senderId, user.id), excludeMatchDeliveries(), excludeDeleted()))
    .then(r => r[0]);

  if (!whisp) {
    res.status(404).json({ error: "Whisp not found" });
    return;
  }

  if (whisp.deliveryMethod === "circle_drop") {
    res.status(400).json({ error: CIRCLE_DROP_PRIVATE_ACTION_ERROR });
    return;
  }

  // Its notification would deliver the whisp's link to the recipient
  // before the whisp itself is due.
  if (whisp.status === "scheduled") {
    res.status(400).json({ error: NOT_YET_DELIVERED_ERROR });
    return;
  }

  const schema = z.object({
    replyText: z.string().min(1).max(300),
    parentReplyId: z.string().max(64).nullable().optional(),
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  // Same-whisp check as the public reply route: an unvalidated parent id
  // would let a reply quote a message from a different thread, and the quoted
  // text renders to whoever opens this one. A stale id degrades to an
  // ordinary reply rather than failing the send.
  let parentReplyId: string | null = null;
  if (parsed.data.parentReplyId) {
    const parent = await db
      .select({ id: whispRepliesTable.id })
      .from(whispRepliesTable)
      .where(and(eq(whispRepliesTable.id, parsed.data.parentReplyId), eq(whispRepliesTable.whispId, whisp.id)))
      .then((r) => r[0]);
    parentReplyId = parent?.id ?? null;
  }

  const id = randomUUID();
  await db.insert(whispRepliesTable).values({
    id,
    whispId: whisp.id,
    replyText: parsed.data.replyText,
    parentReplyId,
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
    void notifyRecipientOfFollowUp(whisp, getPublicAppUrl(req));
  }
});

// Claims the per-whisp external-notification slot atomically (so a burst of
// concurrent follow-ups can't all see "not notified recently"), then sends
// the real email/SMS only if it won; otherwise the recipient still gets the
// in-app notice. Never throws — runs after the response went out.
async function notifyRecipientOfFollowUp(whisp: typeof whispsTable.$inferSelect, appUrl: string): Promise<void> {
  try {
    const now = new Date();
    const claimed = await db
      .update(whispsTable)
      .set({ recipientReplyNotifiedAt: now })
      .where(
        and(
          eq(whispsTable.id, whisp.id),
          or(
            isNull(whispsTable.recipientReplyNotifiedAt),
            lt(whispsTable.recipientReplyNotifiedAt, new Date(now.getTime() - RECIPIENT_REPLY_NOTIFY_COOLDOWN_MS)),
          ),
        ),
      )
      .returning({ id: whispsTable.id });
    await deliverWhisperLink(whisp, appUrl, newReplyHookLine(), "reply_to_recipient", { inAppOnly: claimed.length === 0 });
  } catch (err) {
    logger.error({ err, whispId: whisp.id }, "Failed to notify recipient of sender follow-up");
  }
}

const GUESS_REACTIONS = ["hot", "cold", "no_comment", "confirmed"] as const;

// PATCH /api/whisps/:id/replies/:replyId/guess-reaction — the sender's
// manual response to a "guess who sent it" reply. Deliberately the ONLY way
// a guess ever gets a reaction: there is no automated check anywhere against
// the real sender identity, because that would be an oracle a recipient
// could hammer with names until one came back "correct" — the exact thing
// this app's anti-enumeration rules exist to prevent (see toWhispResponse
// above and whisp_replies.ts's schema comment). The sender decides, the same
// way they decide whether to accept a Reveal request.
router.patch("/:id/replies/:replyId/guess-reaction", requireAuth, async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  const user = await ensureUser(userId!, req);

  const parsed = z.object({ reaction: z.enum(GUESS_REACTIONS) }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const whisp = await db
    .select({ id: whispsTable.id, deliveryMethod: whispsTable.deliveryMethod })
    .from(whispsTable)
    .where(and(eq(whispsTable.id, req.params.id), eq(whispsTable.senderId, user.id), excludeMatchDeliveries(), excludeDeleted()))
    .then(r => r[0]);

  if (!whisp) {
    res.status(404).json({ error: "Whisp not found" });
    return;
  }

  // A reaction to a guess on a public post's shared thread is a public
  // "hot/cold/confirmed" about whoever was guessed — see
  // CIRCLE_DROP_PRIVATE_ACTION_ERROR.
  if (whisp.deliveryMethod === "circle_drop") {
    res.status(400).json({ error: CIRCLE_DROP_PRIVATE_ACTION_ERROR });
    return;
  }

  const reply = await db
    .select({ id: whispRepliesTable.id })
    .from(whispRepliesTable)
    .where(and(
      eq(whispRepliesTable.id, req.params.replyId),
      eq(whispRepliesTable.whispId, whisp.id),
      eq(whispRepliesTable.isGuess, true),
      eq(whispRepliesTable.fromRecipient, true),
    ))
    .then(r => r[0]);

  if (!reply) {
    res.status(404).json({ error: "Guess not found" });
    return;
  }

  await db.update(whispRepliesTable).set({ guessReaction: parsed.data.reaction }).where(eq(whispRepliesTable.id, reply.id));

  const updated = await db.select().from(whispRepliesTable).where(eq(whispRepliesTable.id, reply.id)).then(r => r[0]);
  res.json(updated);
});

// POST /api/whisps/:id/reveal
router.post("/:id/reveal", requireAuth, revealRequestLimiter, async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  const user = await ensureUser(userId!, req);

  // `as string`: same limiter param-typing cast as POST /:id/replies above.
  const whisp = await db
    .select()
    .from(whispsTable)
    .where(and(eq(whispsTable.id, req.params.id as string), eq(whispsTable.senderId, user.id), excludeMatchDeliveries(), excludeDeleted()))
    .then(r => r[0]);

  if (!whisp) {
    res.status(404).json({ error: "Whisp not found" });
    return;
  }

  if (whisp.deliveryMethod === "circle_drop") {
    res.status(400).json({ error: CIRCLE_DROP_PRIVATE_ACTION_ERROR });
    return;
  }

  // Same as POST /:id/replies: the notice would beat the whisp itself there.
  if (whisp.status === "scheduled") {
    res.status(400).json({ error: NOT_YET_DELIVERED_ERROR });
    return;
  }

  // Conditional on the flag still being false, so only the request that
  // actually flips it notifies — repeating the call (or racing it) is a
  // no-op that can't re-text the recipient.
  const flipped = await db
    .update(whispsTable)
    .set({ revealRequested: true })
    .where(and(eq(whispsTable.id, whisp.id), eq(whispsTable.revealRequested, false)))
    .returning({ id: whispsTable.id });

  const updated = await db.select().from(whispsTable).where(eq(whispsTable.id, whisp.id)).then(r => r[0]!);
  // Through toWhispResponse — the raw row carried recipientUserId (an
  // account-existence oracle) and the recipient's pin/archive state.
  res.json(await toWhispResponse(updated, user.id));

  // Notify the recipient a reveal is pending — otherwise they'd only ever
  // find out by coincidentally reopening an already-delivered link. Only
  // whisper_link/group_whisper deliveries have a single recipient contact +
  // channel to notify on (whisperChannel is null for circle_drop/ghost_boost,
  // and deliverWhisperLink already no-ops safely if it's not set). Fire and
  // forget: whether this notification goes out shouldn't affect the reveal
  // request itself, already saved and returned above.
  if (flipped.length > 0 && whisp.whisperChannel) {
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

  if (whisp.deliveryMethod === "circle_drop") {
    res.status(400).json({ error: CIRCLE_DROP_PRIVATE_ACTION_ERROR });
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
