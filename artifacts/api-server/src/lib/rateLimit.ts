import rateLimit from "express-rate-limit";
import { getAuth } from "@clerk/express";

// The public router (track/reply/circle/w/:token) is entirely unauthenticated
// and each of these triggers a real side effect (a DB write, and for reply
// an email to the sender) — without a limit, anyone with (or who obtains) a
// public token could spam it, e.g. to email-bomb the sender via /reply.
// There's no authenticated user here, so this one is IP-keyed by necessity.
export const publicEndpointLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
});

// For endpoints that always run after requireAuth: key by the actual Clerk
// user, not the request IP. An IP-keyed limit is trivially bypassed by one
// account switching networks (mobile carrier CGNAT, a VPN) and, in the other
// direction, falsely throttles unrelated users who happen to share an IP
// (corporate NAT, campus Wi-Fi). Falls back to the IP only in the
// (shouldn't-happen-here, since requireAuth already ran) case auth didn't
// resolve.
function authKeyGenerator(req: any): string {
  return getAuth(req).userId ?? req.ip ?? "unknown";
}

// Whisp creation triggers a real email/SMS/WhatsApp send and, for
// whisper_link, is already capped by the monthly plan limit — but
// ghost_boost/circle_drop have no such cap, so this bounds burst creation
// regardless of delivery method.
export const createWhispLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: authKeyGenerator,
});

// Uploads write real bytes to object storage and count against a sender's
// own storage footprint — bound how many a single account can push through
// per hour regardless of the per-request size cap.
export const uploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: authKeyGenerator,
});

// Each call spends a real (small) Claude API request — bound how many times
// one account can hit "help me find the words" regardless of how many drafts
// they're composing, so a single user can't run up token spend unbounded.
export const noteSuggestionLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: authKeyGenerator,
});

// Starting a phone-verification challenge (lib/phoneVerification.ts) sends a
// real Twilio Verify SMS, same recurring-cost reasoning as createWhispLimiter
// — without a limit, one account could rack up Verify sends (to their own
// number, repeatedly, or by probing numbers they don't own) for free. A
// user only ever needs this a handful of times (initial verification, a
// number change, an expired-code retry), so the cap is tight.
export const phoneVerificationLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: authKeyGenerator,
});

// The "Not sure what to send?" concierge (lib/concierge.ts) is a Claude call
// plus a library lookup — slightly heavier than a plain note suggestion, so
// it gets a somewhat tighter cap, same per-user keying rationale as above.
export const conciergeLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 15,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: authKeyGenerator,
});

// Sending an invite (routes/invites.ts) triggers a real email/SMS/WhatsApp
// send, same recurring-cost reasoning as createWhispLimiter above.
export const inviteLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: authKeyGenerator,
});

// POST /api/text-whisps/check-recipient (routes/textWhisps.ts) answers "is
// this phone number a known, verified Blind Whisper user" — a boolean-only
// response with no other identifying info, same anti-enumeration posture
// Signal/WhatsApp use for contact discovery. That still leaks *some* signal
// per call (product-accepted trade-off — see the route's own comment), so
// this is deliberately much tighter than createWhispLimiter: composing a
// single text whisp only ever needs this a handful of times (checking the
// one person you're actually about to message, maybe retyping a typo'd
// number), so a generous-looking cap here would just be a bigger
// enumeration budget for anyone probing numbers they don't own. 12/hour is
// enough for a real sender's normal use (several genuine compose attempts,
// including retries) while keeping a scripted probing run slow enough to be
// impractical and to show up as an obvious anomaly if watched.
export const textWhispRecipientCheckLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 12,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: authKeyGenerator,
});

// Text Whisp creation (routes/textWhisps.ts) is delivered entirely in-app —
// no Twilio/Resend cost like createWhispLimiter guards against — but it's
// still a real DB write plus a push notification to another real person, so
// this bounds burst creation the same way createWhispLimiter does for
// whisps, at the same cap.
export const createTextWhispLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: authKeyGenerator,
});
