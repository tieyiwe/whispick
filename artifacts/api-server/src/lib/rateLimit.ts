import rateLimit from "express-rate-limit";

// The public router (track/reply/circle/w/:token) is entirely unauthenticated
// and each of these triggers a real side effect (a DB write, and for reply
// an email to the sender) — without a limit, anyone with (or who obtains) a
// public token could spam it, e.g. to email-bomb the sender via /reply.
export const publicEndpointLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
});

// Whisp creation triggers a real email/SMS/WhatsApp send and, for
// whisper_link, is already capped by the monthly plan limit — but
// ghost_boost/circle_drop have no such cap, so this bounds burst creation
// regardless of delivery method.
export const createWhispLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
});

// Uploads write real bytes to object storage and count against a sender's
// own storage footprint — bound how many a single account can push through
// per hour regardless of the per-request size cap.
export const uploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
});
