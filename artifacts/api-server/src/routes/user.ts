import { Router } from "express";
import { getAuth } from "@clerk/express";
import { db } from "@workspace/db";
import {
  usersTable,
  pushSubscriptionsTable,
  notificationsTable,
  notificationReadsTable,
  whispsTable,
  whispRepliesTable,
  whispCategoriesTable,
  textWhispsTable,
  policyVersionsTable,
  policyAcceptancesTable,
  debateTopicsTable,
  followsTable,
  whisperBoxMessagesTable,
} from "@workspace/db";
import { eq, and, or, ne, isNull, isNotNull, desc, count, notInArray, inArray, gte } from "drizzle-orm";
import { randomUUID } from "crypto";
import { z } from "zod";
import { requireAuth } from "../lib/auth";
import { ensureUser } from "../lib/ensureUser";
import { getVapidPublicKey } from "../lib/push";
import { GENDER_OPTIONS, AGE_RANGE_OPTIONS } from "../lib/demographics";
import { SUPPORTED_LANGUAGES } from "../lib/languages";
import { updateWhispererAvatar, isWhisperBoxHandlePersonalized } from "../lib/whispererHandle";
import { normalizePhoneE164 } from "../lib/phone";
import { startPhoneVerification, checkPhoneVerification } from "../lib/phoneVerification";
import { phoneVerificationLimiter, confirmPhoneVerificationLimiter } from "../lib/rateLimit";

const router = Router();

// GET /api/user/profile
router.get("/profile", requireAuth, async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  const user = await ensureUser(userId!, req);
  res.json({
    id: user.id,
    clerkId: user.clerkId,
    email: user.email,
    fullName: user.fullName,
    avatarUrl: user.avatarUrl,
    phone: user.phone,
    phoneVerifiedAt: user.phoneVerifiedAt,
    countryCode: user.countryCode,
    gender: user.gender,
    ageRange: user.ageRange,
    preferredLanguage: user.preferredLanguage,
    whispererHandle: user.whispererHandle,
    whispererAvatarId: user.whispererAvatarId,
    whisperBoxHandlePersonalized: isWhisperBoxHandlePersonalized(user.whisperBoxHandle, user.fullName),
    mfaNudgeDismissedAt: user.mfaNudgeDismissedAt,
    plan: user.plan,
    boostCredits: user.boostCredits,
    whisperLinksUsed: user.whisperLinksUsed,
    role: user.role,
    emailNotificationsEnabled: user.emailNotificationsEnabled,
    showOnlineStatus: user.showOnlineStatus,
    notifyOnNewSignup: user.notifyOnNewSignup,
    notifyOnNewDebateTopic: user.notifyOnNewDebateTopic,
    twoFactorEnabled: user.twoFactorEnabled,
    createdAt: user.createdAt,
  });
});

const RECAP_PERIODS = ["all_time", "last_30_days"] as const;
type RecapPeriod = (typeof RECAP_PERIODS)[number];

// GET /api/user/recap — the shareable "Wrapped"-style personal stat card:
// real, honestly-computed numbers only (no fabricated percentile/"top X%"
// claims — this app has no leaderboard infra to back that up). Meant to be
// screenshotted and shared to a Story/feed as organic growth — every stat
// here is the CALLER'S OWN activity, never anyone else's, so nothing here
// needs the anti-enumeration care the rest of the app's public surfaces do.
router.get("/recap", requireAuth, async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  const user = await ensureUser(userId!, req);
  const period: RecapPeriod = RECAP_PERIODS.includes(req.query.period as RecapPeriod) ? (req.query.period as RecapPeriod) : "all_time";
  const since = period === "last_30_days" ? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) : null;

  // Loosely typed on purpose: this is used against several different
  // tables' createdAt columns below, and a precise shared type would just
  // fight Drizzle's per-table column typing for no real benefit — gte()
  // itself still enforces the right shape at each call site.
  function sinceClause(column: any) {
    return since ? gte(column, since) : undefined;
  }

  const [
    [{ count: totalSent } = { count: 0 }],
    [{ count: totalReceived } = { count: 0 }],
    [{ count: repliesReceived } = { count: 0 }],
    [{ count: circlePosts } = { count: 0 }],
    [{ count: debateTopicsPosted } = { count: 0 }],
    [{ count: followerCount } = { count: 0 }],
    [{ count: whisperBoxMessagesReceived } = { count: 0 }],
    topCategoryRows,
  ] = await Promise.all([
    db.select({ count: count() }).from(whispsTable).where(and(eq(whispsTable.senderId, user.id), sinceClause(whispsTable.createdAt))),
    db
      .select({ count: count() })
      .from(whispsTable)
      .where(
        and(
          eq(whispsTable.recipientUserId, user.id),
          inArray(whispsTable.deliveryMethod, ["whisper_link", "group_whisper"]),
          sinceClause(whispsTable.createdAt),
        ),
      ),
    db
      .select({ count: count() })
      .from(whispRepliesTable)
      .innerJoin(whispsTable, eq(whispRepliesTable.whispId, whispsTable.id))
      .where(and(eq(whispsTable.senderId, user.id), eq(whispRepliesTable.fromRecipient, true), sinceClause(whispRepliesTable.createdAt))),
    db
      .select({ count: count() })
      .from(whispsTable)
      .where(and(eq(whispsTable.senderId, user.id), eq(whispsTable.deliveryMethod, "circle_drop"), sinceClause(whispsTable.createdAt))),
    db
      .select({ count: count() })
      .from(debateTopicsTable)
      .where(
        and(
          eq(debateTopicsTable.authorId, user.id),
          isNull(debateTopicsTable.deletedByAuthorAt),
          isNull(debateTopicsTable.removedByAdminAt),
          sinceClause(debateTopicsTable.createdAt),
        ),
      ),
    // Followers aren't period-scoped — "how many people follow you" is a
    // running total, not something that resets each recap window.
    db.select({ count: count() }).from(followsTable).where(eq(followsTable.followedUserId, user.id)),
    user.whisperBoxEnabled
      ? db
          .select({ count: count() })
          .from(whisperBoxMessagesTable)
          .where(and(eq(whisperBoxMessagesTable.recipientUserId, user.id), isNull(whisperBoxMessagesTable.removedByAdminAt), sinceClause(whisperBoxMessagesTable.createdAt)))
      : Promise.resolve([{ count: 0 }]),
    db
      .select({ category: whispCategoriesTable.category, total: count() })
      .from(whispCategoriesTable)
      .innerJoin(whispsTable, eq(whispCategoriesTable.whispId, whispsTable.id))
      .where(and(eq(whispsTable.senderId, user.id), eq(whispCategoriesTable.rank, 1), sinceClause(whispsTable.createdAt)))
      .groupBy(whispCategoriesTable.category)
      .orderBy(desc(count()))
      .limit(1),
  ]);

  res.json({
    period,
    totalSent,
    totalReceived,
    repliesReceived,
    circlePosts,
    debateTopicsPosted,
    followerCount,
    whisperBoxMessagesReceived: user.whisperBoxEnabled ? whisperBoxMessagesReceived : null,
    topCategory: topCategoryRows[0]?.category ?? null,
    memberSince: user.createdAt,
    whispererHandle: user.whispererHandle,
    // The SEPARATE, display-name-based handle used only for the Whisper Box
    // URL — see users.ts's whisperBoxHandle column comment. Null until
    // enable() has run once; distinct from whisperBoxMessagesReceived above,
    // which is null for a different reason (box currently disabled).
    whisperBoxHandle: user.whisperBoxHandle,
  });
});

// POST /api/user/mfa-nudge/dismiss — "skip for now" on the two-factor setup
// nudge. Whether 2FA is actually enabled is still asked of Clerk directly,
// client-side, for anything access-control-relevant — the nudge itself
// never gates on it. users.twoFactorEnabled is a separate, best-effort,
// admin-facing MIRROR of that Clerk fact (see its schema comment) used only
// to power the admin compliance dashboard; this endpoint only remembers a
// skip, so it doesn't nag again on another device until the next natural
// prompt point (see users.mfaNudgeDismissedAt's schema comment).
router.post("/mfa-nudge/dismiss", requireAuth, async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  const user = await ensureUser(userId!, req);
  await db.update(usersTable).set({ mfaNudgeDismissedAt: new Date() }).where(eq(usersTable.id, user.id));
  res.status(204).send();
});

// PATCH /api/user/profile — also how the one-time demographic gate (see
// lib/demographics.ts) saves a user's answer, and how Settings lets them
// change it later; both go through the same fields, same endpoint.
router.patch("/profile", requireAuth, async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  const user = await ensureUser(userId!, req);

  const schema = z.object({
    fullName: z.string().nullable().optional(),
    avatarUrl: z.string().nullable().optional(),
    gender: z.enum(GENDER_OPTIONS).nullable().optional(),
    ageRange: z.enum(AGE_RANGE_OPTIONS).nullable().optional(),
    emailNotificationsEnabled: z.boolean().optional(),
    showOnlineStatus: z.boolean().optional(),
    notifyOnNewSignup: z.boolean().optional(),
    notifyOnNewDebateTopic: z.boolean().optional(),
    countryCode: z.string().length(2).nullable().optional(),
    preferredLanguage: z.enum(SUPPORTED_LANGUAGES).optional(),
    whispererAvatarId: z.string().max(50).nullable().optional(),
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { whispererAvatarId, ...profileFields } = parsed.data;

  if (whispererAvatarId !== undefined) {
    const result = await updateWhispererAvatar(user.id, whispererAvatarId);
    if (!result.ok) {
      res.status(400).json({ error: "Not a valid avatar." });
      return;
    }
  }

  await db
    .update(usersTable)
    .set({ ...profileFields, ...(profileFields.countryCode ? { countryCode: profileFields.countryCode.toUpperCase() } : {}) })
    .where(eq(usersTable.id, user.id));
  const updated = await db.select().from(usersTable).where(eq(usersTable.id, user.id)).then(r => r[0]);

  res.json({
    id: updated.id,
    clerkId: updated.clerkId,
    email: updated.email,
    fullName: updated.fullName,
    avatarUrl: updated.avatarUrl,
    phone: updated.phone,
    phoneVerifiedAt: updated.phoneVerifiedAt,
    countryCode: updated.countryCode,
    gender: updated.gender,
    ageRange: updated.ageRange,
    preferredLanguage: updated.preferredLanguage,
    whispererHandle: updated.whispererHandle,
    whispererAvatarId: updated.whispererAvatarId,
    mfaNudgeDismissedAt: updated.mfaNudgeDismissedAt,
    plan: updated.plan,
    boostCredits: updated.boostCredits,
    whisperLinksUsed: updated.whisperLinksUsed,
    emailNotificationsEnabled: updated.emailNotificationsEnabled,
    showOnlineStatus: updated.showOnlineStatus,
    notifyOnNewSignup: updated.notifyOnNewSignup,
    notifyOnNewDebateTopic: updated.notifyOnNewDebateTopic,
    createdAt: updated.createdAt,
  });
});

// GET /api/user/push-public-key
// GET /api/user/policy-status — the pending-consent check behind the
// policy-update prompt (see policy_versions.ts): for each doc type, the
// LATEST published version this user hasn't accepted yet. Empty `pending`
// means nothing to prompt for.
router.get("/policy-status", requireAuth, async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  const user = await ensureUser(userId!, req);

  const published = await db
    .select()
    .from(policyVersionsTable)
    .where(isNotNull(policyVersionsTable.publishedAt))
    .orderBy(desc(policyVersionsTable.publishedAt));

  // First row per docType is the latest published — the only one consent is
  // ever required for (accepting the latest supersedes anything older).
  const latestByDocType = new Map<string, typeof published[number]>();
  for (const version of published) {
    if (!latestByDocType.has(version.docType)) latestByDocType.set(version.docType, version);
  }
  const latest = [...latestByDocType.values()];
  if (latest.length === 0) {
    res.json({ pending: [] });
    return;
  }

  const accepted = await db
    .select({ policyVersionId: policyAcceptancesTable.policyVersionId })
    .from(policyAcceptancesTable)
    .where(and(eq(policyAcceptancesTable.userId, user.id), inArray(policyAcceptancesTable.policyVersionId, latest.map((v) => v.id))));
  const acceptedIds = new Set(accepted.map((a) => a.policyVersionId));

  res.json({
    pending: latest
      .filter((v) => !acceptedIds.has(v.id))
      .map((v) => ({ id: v.id, docType: v.docType, summary: v.summary, publishedAt: v.publishedAt })),
  });
});

const acceptPoliciesSchema = z.object({ policyVersionIds: z.array(z.string().max(64)).min(1).max(10) });

// POST /api/user/policy-acceptances — the "I agree" click. Only published
// versions are acceptable (a draft id is silently ignored rather than
// recorded — nothing was ever shown to agree to), and re-accepting is a
// no-op thanks to the unique index.
router.post("/policy-acceptances", requireAuth, async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  const user = await ensureUser(userId!, req);

  const parsed = acceptPoliciesSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const versions = await db
    .select({ id: policyVersionsTable.id })
    .from(policyVersionsTable)
    .where(and(inArray(policyVersionsTable.id, parsed.data.policyVersionIds), isNotNull(policyVersionsTable.publishedAt)));

  if (versions.length > 0) {
    await db
      .insert(policyAcceptancesTable)
      .values(versions.map((v) => ({ id: randomUUID(), userId: user.id, policyVersionId: v.id })))
      .onConflictDoNothing();
  }

  res.status(204).send();
});

router.get("/push-public-key", requireAuth, (_req, res): void => {
  const publicKey = getVapidPublicKey();
  if (!publicKey) {
    res.status(503).json({ error: "Push notifications are not configured" });
    return;
  }
  res.json({ publicKey });
});

const pushSubscriptionSchema = z.object({
  endpoint: z.string().min(1),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
});

// POST /api/user/push-subscription — register a browser's push subscription
router.post("/push-subscription", requireAuth, async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  const user = await ensureUser(userId!, req);

  const parsed = pushSubscriptionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  await db
    .insert(pushSubscriptionsTable)
    .values({
      id: randomUUID(),
      userId: user.id,
      endpoint: parsed.data.endpoint,
      p256dh: parsed.data.keys.p256dh,
      auth: parsed.data.keys.auth,
    })
    .onConflictDoUpdate({
      target: pushSubscriptionsTable.endpoint,
      set: { userId: user.id, p256dh: parsed.data.keys.p256dh, auth: parsed.data.keys.auth },
    });

  res.status(201).json({ ok: true });
});

// DELETE /api/user/push-subscription — unsubscribe this browser
router.delete("/push-subscription", requireAuth, async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  const user = await ensureUser(userId!, req);

  const parsed = z.object({ endpoint: z.string().min(1) }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  await db
    .delete(pushSubscriptionsTable)
    .where(and(eq(pushSubscriptionsTable.userId, user.id), eq(pushSubscriptionsTable.endpoint, parsed.data.endpoint)));

  res.status(204).send();
});

// ---------------------------------------------------------------------------
// Phone verification — a real, one-time Twilio Verify SMS challenge that
// proves a user controls the phone number they claim (see
// lib/phoneVerification.ts for why this can't be TOTP/push-based). Once
// confirmed, lib/deliver.ts can route SMS/WhatsApp whisps addressed to this
// number through the app's own in-app notifications instead of paying for a
// real Twilio send — see that file's matching logic. This is entirely
// separate from (and doesn't get satisfied by) the best-effort,
// never-verified users.phone Clerk sync in ensureUser.ts.
// ---------------------------------------------------------------------------

const startPhoneVerificationSchema = z.object({
  phone: z.string().min(1).max(32),
  // ISO 3166-1 alpha-2, from the country picker in CountryPhoneInput.tsx.
  // Optional (and harmless when omitted) since `phone` is already a fully
  // international "+"-prefixed value by the time it gets here — see
  // normalizePhoneE164's own comment — but passing it keeps this endpoint
  // robust even against a future caller that sends a bare national number.
  countryCode: z.string().length(2).optional(),
});

// POST /api/user/phone/start-verification — sends a Twilio Verify SMS code
// to the given number. Rate-limited: each call is a real SMS cost, same
// reasoning as createWhispLimiter.
router.post("/phone/start-verification", requireAuth, phoneVerificationLimiter, async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  await ensureUser(userId!, req);

  const parsed = startPhoneVerificationSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const normalized = normalizePhoneE164(parsed.data.phone, parsed.data.countryCode);
  if (!normalized) {
    res.status(400).json({ error: "That doesn't look like a valid phone number" });
    return;
  }

  const result = await startPhoneVerification(normalized);
  if (!result.ok) {
    res.status(502).json({ error: result.error });
    return;
  }

  res.status(200).json({ ok: true });
});

const confirmPhoneVerificationSchema = z.object({
  phone: z.string().min(1).max(32),
  code: z.string().min(1).max(12),
  countryCode: z.string().length(2).optional(),
});

// POST /api/user/phone/confirm-verification — checks the code against
// Twilio Verify and, on success, sets users.phone (normalized) +
// users.phoneVerifiedAt for the authenticated user. `phone` is re-sent (and
// re-normalized) rather than trusted from any prior request, since there's
// no server-side "verification in progress for this user" state to look up
// otherwise — Twilio Verify itself is the source of truth for which
// (phone, code) pairs are valid.
router.post("/phone/confirm-verification", requireAuth, confirmPhoneVerificationLimiter, async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  const user = await ensureUser(userId!, req);

  const parsed = confirmPhoneVerificationSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const normalized = normalizePhoneE164(parsed.data.phone, parsed.data.countryCode);
  if (!normalized) {
    res.status(400).json({ error: "That doesn't look like a valid phone number" });
    return;
  }

  const result = await checkPhoneVerification(normalized, parsed.data.code);
  if (!result.ok) {
    res.status(400).json({ error: result.error });
    return;
  }

  // A phone number is the routing key for in-app whisp delivery
  // (findVerifiedRecipient in lib/deliver.ts), so it must map to exactly one
  // verified account. Phone numbers get recycled between people, and the
  // person now holding this SIM just proved control of it — so clear any
  // OTHER account still claiming it as verified. Without this, a recycled
  // number could resolve to a stranger's old account and an anonymized whisp
  // meant for the current holder would land in that stranger's in-app inbox
  // instead of being texted to the right person.
  await db
    .update(usersTable)
    .set({ phone: null, phoneVerifiedAt: null })
    .where(and(eq(usersTable.phone, normalized), ne(usersTable.id, user.id)));

  await db
    .update(usersTable)
    .set({
      phone: normalized,
      phoneVerifiedAt: new Date(),
      // Real, user-confirmed country beats the best-effort IP-geolocation
      // guess that may already be sitting in this same row — see
      // users.countryCode's own schema comment. Only overwritten when the
      // client actually sent one; an old client hitting this endpoint
      // without it just leaves whatever was there before untouched.
      ...(parsed.data.countryCode ? { countryCode: parsed.data.countryCode.toUpperCase() } : {}),
    })
    .where(eq(usersTable.id, user.id));

  // Backfill: link any Text Whisp already sent to this exact number, whose
  // recipient wasn't a known verified account YET at send time
  // (routes/textWhisps.ts POST / only matches synchronously against
  // findVerifiedRecipient at that instant — recipientUserId is never
  // re-checked later). Without this, a real recipient who verifies their
  // number moments — or days — after a Text Whisp was already sent to it
  // (the ordinary "I got a text, so I signed up" flow, or a scheduled send
  // that fires after they verify) stays permanently unlinked: it never
  // shows up in their own authenticated Text Whisps list/detail view at
  // all — no closed scroll to tap, because the recipient-side query
  // (recipientUserId = viewer) simply never matches that row — even though
  // they now hold the exact verified number it was sent to. Scoped to rows
  // still unmatched (recipientUserId is null) and excludes this user's own
  // sends (ne senderId) so someone who Text Whisped their own not-yet-
  // verified number before verifying it doesn't become their own
  // recipient. Never touches an already-matched row — this only fills a
  // gap, never reassigns an existing match (e.g. after the recycled-number
  // clear above, a prior holder's already-answered Text Whisps stay theirs,
  // not silently handed to whoever verifies the number next).
  await db
    .update(textWhispsTable)
    .set({ recipientUserId: user.id })
    .where(and(eq(textWhispsTable.recipientPhone, normalized), isNull(textWhispsTable.recipientUserId), ne(textWhispsTable.senderId, user.id)));

  const updated = await db.select().from(usersTable).where(eq(usersTable.id, user.id)).then((r) => r[0]!);
  res.status(200).json({ phone: updated.phone, phoneVerifiedAt: updated.phoneVerifiedAt, countryCode: updated.countryCode });
});

// ---------------------------------------------------------------------------
// Notifications — the persistent, in-app counterpart to push (see
// lib/push.ts): a broadcast (targetUserId null) or one addressed to this
// user specifically, most recent first, with per-user read state joined in
// from notificationReadsTable (a broadcast row is shared by everyone, so
// read state can't live on the notification row itself).
// ---------------------------------------------------------------------------

function visibleToUser(userId: string) {
  return or(isNull(notificationsTable.targetUserId), eq(notificationsTable.targetUserId, userId));
}

// GET /api/user/notifications
router.get("/notifications", requireAuth, async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  const user = await ensureUser(userId!, req);

  const rows = await db
    .select({
      id: notificationsTable.id,
      targetUserId: notificationsTable.targetUserId,
      title: notificationsTable.title,
      body: notificationsTable.body,
      url: notificationsTable.url,
      kind: notificationsTable.kind,
      createdByAdminId: notificationsTable.createdByAdminId,
      createdAt: notificationsTable.createdAt,
      readAt: notificationReadsTable.readAt,
    })
    .from(notificationsTable)
    .leftJoin(
      notificationReadsTable,
      and(eq(notificationReadsTable.notificationId, notificationsTable.id), eq(notificationReadsTable.userId, user.id)),
    )
    .where(visibleToUser(user.id))
    .orderBy(desc(notificationsTable.createdAt))
    .limit(50);

  const unreadCount = rows.filter((r) => !r.readAt).length;

  res.json({
    items: rows.map(({ readAt, ...n }) => ({ ...n, read: !!readAt })),
    unreadCount,
  });
});

// GET /api/user/notifications/unread-count — a lightweight poll target for
// a nav badge, without pulling the full list every time. Also breaks out
// unread REPLY notifications separately, so the Replies tab can show a badge
// that means "someone replied" specifically — an open/watch notification
// lighting up the Replies tab would send the user looking for a message
// that isn't there.
router.get("/notifications/unread-count", requireAuth, async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  const user = await ensureUser(userId!, req);

  const unreadOnly = and(visibleToUser(user.id), isNull(notificationReadsTable.id));

  const [row, replyRow] = await Promise.all([
    db
      .select({ count: count() })
      .from(notificationsTable)
      .leftJoin(
        notificationReadsTable,
        and(eq(notificationReadsTable.notificationId, notificationsTable.id), eq(notificationReadsTable.userId, user.id)),
      )
      .where(unreadOnly)
      .then((r) => r[0]),
    db
      .select({ count: count() })
      .from(notificationsTable)
      .leftJoin(
        notificationReadsTable,
        and(eq(notificationReadsTable.notificationId, notificationsTable.id), eq(notificationReadsTable.userId, user.id)),
      )
      .where(and(unreadOnly, eq(notificationsTable.kind, "reply")))
      .then((r) => r[0]),
  ]);

  res.json({ unreadCount: row?.count ?? 0, unreadReplyCount: replyRow?.count ?? 0 });
});

// POST /api/user/notifications/:id/read
router.post("/notifications/:id/read", requireAuth, async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  const user = await ensureUser(userId!, req);

  const notification = await db
    .select({ id: notificationsTable.id })
    .from(notificationsTable)
    .where(and(eq(notificationsTable.id, req.params.id), visibleToUser(user.id)))
    .then((r) => r[0]);
  if (!notification) {
    res.status(404).json({ error: "Notification not found" });
    return;
  }

  const existing = await db
    .select({ id: notificationReadsTable.id })
    .from(notificationReadsTable)
    .where(and(eq(notificationReadsTable.notificationId, notification.id), eq(notificationReadsTable.userId, user.id)))
    .then((r) => r[0]);

  if (!existing) {
    // onConflictDoNothing: the unique (notificationId, userId) index makes a
    // concurrent duplicate (second tab, read-all racing this) a no-op
    // instead of a duplicate row.
    await db
      .insert(notificationReadsTable)
      .values({ id: randomUUID(), notificationId: notification.id, userId: user.id })
      .onConflictDoNothing();
  }

  res.status(204).send();
});

// ---------------------------------------------------------------------------
// Recent recipients — powers autocomplete on the Whisper Link recipient field,
// so a returning sender doesn't retype an address they've already used.
//
// Derived from the sender's own outbound history rather than stored as a
// separate address book: the addresses are already on their whisps, a second
// copy would drift, and there's nothing to keep in sync or clean up when a
// whisp is deleted. It also means this works on a new device immediately,
// which a localStorage list would not.
//
// Strictly scoped to whisps this user SENT. That matters beyond the obvious
// privacy point: it's the sender's own typed input coming back to them, so it
// reveals nothing about who holds an account — the fact the anti-enumeration
// rules exist to protect. Nothing here reads whisps sent TO this user.
// ---------------------------------------------------------------------------
const RECENT_RECIPIENT_LIMIT = 50;
// Scanned before de-duplication, so someone who whisps the same handful of
// people repeatedly still surfaces the full set rather than one name.
const RECENT_RECIPIENT_SCAN = 400;

// GET /api/user/recent-recipients
router.get("/recent-recipients", requireAuth, async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  const user = await ensureUser(userId!, req);

  const [whisps, textWhisps] = await Promise.all([
    db
      .select({
        email: whispsTable.recipientEmail,
        phone: whispsTable.recipientPhone,
        createdAt: whispsTable.createdAt,
      })
      .from(whispsTable)
      .where(eq(whispsTable.senderId, user.id))
      .orderBy(desc(whispsTable.createdAt))
      .limit(RECENT_RECIPIENT_SCAN),
    db
      .select({ phone: textWhispsTable.recipientPhone, createdAt: textWhispsTable.createdAt })
      .from(textWhispsTable)
      .where(eq(textWhispsTable.senderId, user.id))
      .orderBy(desc(textWhispsTable.createdAt))
      .limit(RECENT_RECIPIENT_SCAN),
  ]);

  type Entry = { value: string; kind: "email" | "phone"; lastUsedAt: Date; useCount: number };
  const byKey = new Map<string, Entry>();

  function record(raw: string | null, kind: "email" | "phone", at: Date) {
    const value = raw?.trim();
    if (!value) return;
    // Case-insensitive for emails, digits-only for phones — the same keys the
    // client dedupes on (lib/recipients.ts), so one contact typed two ways
    // doesn't show up as two suggestions.
    const key = kind === "email" ? value.toLowerCase() : value.replace(/\D/g, "");
    if (!key) return;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, { value, kind, lastUsedAt: at, useCount: 1 });
      return;
    }
    existing.useCount += 1;
    // Keep the most recent spelling, since that's the one they'd expect back.
    if (at > existing.lastUsedAt) {
      existing.lastUsedAt = at;
      existing.value = value;
    }
  }

  for (const row of whisps) {
    record(row.email, "email", row.createdAt);
    record(row.phone, "phone", row.createdAt);
  }
  for (const row of textWhisps) {
    record(row.phone, "phone", row.createdAt);
  }

  const items = [...byKey.values()]
    .sort((a, b) => b.lastUsedAt.getTime() - a.lastUsedAt.getTime())
    .slice(0, RECENT_RECIPIENT_LIMIT)
    .map((e) => ({ ...e, lastUsedAt: e.lastUsedAt.toISOString() }));

  res.json({ items });
});

// POST /api/user/notifications/read-all
router.post("/notifications/read-all", requireAuth, async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  const user = await ensureUser(userId!, req);

  const alreadyRead = await db
    .select({ notificationId: notificationReadsTable.notificationId })
    .from(notificationReadsTable)
    .where(eq(notificationReadsTable.userId, user.id));
  const alreadyReadIds = alreadyRead.map((r) => r.notificationId);

  const unread = await db
    .select({ id: notificationsTable.id })
    .from(notificationsTable)
    .where(
      alreadyReadIds.length
        ? and(visibleToUser(user.id), notInArray(notificationsTable.id, alreadyReadIds))
        : visibleToUser(user.id),
    );

  if (unread.length) {
    await db
      .insert(notificationReadsTable)
      .values(unread.map((n) => ({ id: randomUUID(), notificationId: n.id, userId: user.id })))
      .onConflictDoNothing();
  }

  res.status(204).send();
});

export default router;
