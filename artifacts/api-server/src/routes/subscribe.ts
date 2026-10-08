import { Router } from "express";
import { db, matchSubscribersTable } from "@workspace/db";
import { eq, and, or, isNull, lt, sql } from "drizzle-orm";
import { randomUUID } from "crypto";
import { z } from "zod";
import { VIDEO_CATEGORIES } from "../lib/categorize";
import { sendEmail, subscriptionVerificationEmailHtml } from "../lib/email";
import { getPublicAppUrl } from "../lib/publicUrl";

const router = Router();

const VALID_CATEGORY_KEYS = new Set<string>(VIDEO_CATEGORIES.map((c) => c.key));

// Verification-email throttle per address. POST /subscribe is
// unauthenticated and (re)sends a confirmation for any unverified address,
// so without this it's a free way to email-bomb a stranger's inbox from our
// domain (the IP limiter alone doesn't stop a distributed sender).
export const VERIFICATION_RESEND_MIN_GAP_MS = 10 * 60 * 1000;
export const VERIFICATION_MAX_SENDS_PER_DAY = 3;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Atomically claims one verification send for this subscriber row, or
 * returns false when the address is inside the resend gap or has hit its
 * daily cap. One conditional UPDATE (not read-then-write) so concurrent
 * POSTs for the same address can't each pass the check.
 */
async function claimVerificationSend(subscriberId: string): Promise<boolean> {
  const now = new Date();
  const gapStart = new Date(now.getTime() - VERIFICATION_RESEND_MIN_GAP_MS);
  const dayStart = new Date(now.getTime() - DAY_MS);
  const t = matchSubscribersTable;
  const windowExpired = sql`(${t.verificationWindowStartedAt} IS NULL OR ${t.verificationWindowStartedAt} < ${dayStart.toISOString()}::timestamptz)`;
  const claimed = await db
    .update(t)
    .set({
      lastVerificationSentAt: now,
      verificationWindowStartedAt: sql`CASE WHEN ${windowExpired} THEN ${now.toISOString()}::timestamptz ELSE ${t.verificationWindowStartedAt} END`,
      verificationSendCount: sql`CASE WHEN ${windowExpired} THEN 1 ELSE COALESCE(${t.verificationSendCount}, 0) + 1 END`,
    })
    .where(
      and(
        eq(t.id, subscriberId),
        or(isNull(t.lastVerificationSentAt), lt(t.lastVerificationSentAt, gapStart)),
        or(windowExpired, sql`COALESCE(${t.verificationSendCount}, 0) < ${VERIFICATION_MAX_SENDS_PER_DAY}`),
      ),
    )
    .returning({ id: t.id });
  return claimed.length > 0;
}

const subscribeSchema = z.object({
  email: z.string().email(),
  categories: z
    .array(z.string())
    .min(1, "Pick at least one topic")
    .max(8, "Pick up to 8 topics")
    .refine((arr) => arr.every((k) => VALID_CATEGORY_KEYS.has(k)), { message: "Unknown category" }),
});

// POST /api/public/subscribe — opt in to receive anonymous Ghost Boost
// whisps on chosen topics. No Blind Whisper account needed, matching the app's
// no-account-required spirit for receiving a whisp at all. Double opt-in
// (a verification email must be confirmed before this row is match-eligible
// — see lib/matching.ts) so a stranger can't sign someone else's email up
// to be spammed with anonymous videos.
router.post("/subscribe", async (req, res): Promise<void> => {
  const parsed = subscribeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  // Normalized so "Foo@x.com" and "foo@x.com" can never create two rows for
  // the same inbox (which could otherwise each independently pass as a
  // distinct match candidate in the same Ghost Boost sweep).
  const email = parsed.data.email.trim().toLowerCase();
  const { categories } = parsed.data;
  const existing = await db.select().from(matchSubscribersTable).where(eq(matchSubscribersTable.email, email)).then((r) => r[0]);

  let token: string;
  let alreadyVerified: boolean;
  let subscriberId: string;

  if (existing) {
    token = existing.token;
    subscriberId = existing.id;
    // A previously-unsubscribed address must re-confirm via a fresh click
    // on the emailed verification link before it's match-eligible again —
    // clearing unsubscribedAt right here, on a bare POST with no proof of
    // inbox access, would let anyone who merely knows the address silently
    // resubscribe it against its owner's wishes.
    const wasUnsubscribed = !!existing.unsubscribedAt;
    alreadyVerified = !!existing.verifiedAt && !wasUnsubscribed;
    // Same reasoning applies to `categories`: a bare POST proves nothing
    // about inbox access, so it must never rewrite an ACTIVE, verified
    // subscription's topics (anyone who knows the address could redirect
    // what the real owner receives). Unverified or unsubscribed rows are
    // fair game — the emailed confirmation click is still required before
    // anything matches.
    if (!alreadyVerified) {
      await db
        .update(matchSubscribersTable)
        .set({ categories, ...(wasUnsubscribed ? { verifiedAt: null } : {}) })
        .where(eq(matchSubscribersTable.id, existing.id));
    }
  } else {
    token = randomUUID();
    alreadyVerified = false;
    subscriberId = randomUUID();
    await db.insert(matchSubscribersTable).values({ id: subscriberId, email, categories, token });
  }

  // A throttled resend is silent — same constant response either way, so
  // the throttle can't be probed to learn anything about the address.
  if (!alreadyVerified && (await claimVerificationSend(subscriberId))) {
    const verifyUrl = `${getPublicAppUrl(req)}/verify-subscription?token=${token}`;
    void sendEmail(email, "Confirm your Blind Whisper subscription", subscriptionVerificationEmailHtml(verifyUrl), {
      whispId: null,
      purpose: "subscription_verification",
    });
  }

  // Deliberately constant, NOT the real `alreadyVerified`: this is an
  // unauthenticated endpoint, and branching the response on whether the
  // posted address is already a confirmed subscriber turns it into a free
  // membership oracle — anyone could probe an arbitrary third-party email and
  // learn from the response whether it's on the subscriber list. The generic
  // "check your inbox" copy the frontend shows for `false` is correct for
  // every case (a genuinely-already-verified re-subscribe simply gets no new
  // email, which is the desired no-op). Email dispatch above is fire-and-
  // forget, so response timing doesn't leak the branch either.
  res.json({ ok: true, alreadyVerified: false });
});

// GET /api/public/subscribe/verify — one-click confirmation link, so a GET
// (not a POST) is the right tool here, same as any mailing-list confirm.
router.get("/subscribe/verify", async (req, res): Promise<void> => {
  const token = typeof req.query.token === "string" ? req.query.token : null;
  if (!token) {
    res.status(400).json({ error: "Missing token" });
    return;
  }

  const subscriber = await db.select().from(matchSubscribersTable).where(eq(matchSubscribersTable.token, token)).then((r) => r[0]);
  if (!subscriber) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  // Also clears unsubscribedAt: this click is the proof-of-inbox-access
  // that a resubscribe-after-unsubscribe needs (see POST /subscribe above),
  // so it's the right place to actually flip the flag back.
  if (!subscriber.verifiedAt || subscriber.unsubscribedAt) {
    await db
      .update(matchSubscribersTable)
      .set({ verifiedAt: new Date(), unsubscribedAt: null })
      .where(eq(matchSubscribersTable.id, subscriber.id));
  }

  res.json({ ok: true });
});

// GET /api/public/subscribe/unsubscribe — one-click, no login, standard for
// email compliance. Idempotent.
router.get("/subscribe/unsubscribe", async (req, res): Promise<void> => {
  const token = typeof req.query.token === "string" ? req.query.token : null;
  if (!token) {
    res.status(400).json({ error: "Missing token" });
    return;
  }

  const subscriber = await db.select().from(matchSubscribersTable).where(eq(matchSubscribersTable.token, token)).then((r) => r[0]);
  if (!subscriber) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  if (!subscriber.unsubscribedAt) {
    await db.update(matchSubscribersTable).set({ unsubscribedAt: new Date() }).where(eq(matchSubscribersTable.id, subscriber.id));
  }

  res.json({ ok: true });
});

export default router;
