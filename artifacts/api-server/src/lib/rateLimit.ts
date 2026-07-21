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
