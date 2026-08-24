// Strict digits-only parse with a sane ceiling. parseInt alone accepted
// "3 replies" as 3 (so a typo'd value silently "worked" instead of falling
// back as the comments promise) and accepted absurd magnitudes like 1e20,
// which are effectively unlimited yet never return null — leaking a nonsense
// number into API responses that report a remaining count.
const MAX_CONFIGURABLE_LIMIT = 100_000;

function parsePositiveIntOr(raw: string, fallback: number): number {
  if (!/^\d+$/.test(raw)) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isSafeInteger(parsed) && parsed <= MAX_CONFIGURABLE_LIMIT ? parsed : fallback;
}

// Free-plan Whisper Link cap, overridable without a code change via
// FREE_PLAN_WHISPER_LINKS — set it to "unlimited" to lift the cap entirely
// (useful while billing isn't built out yet, or for end-to-end delivery
// testing, where the 3/month default otherwise blocks after a few sends and
// has to be cleared straight from the database). Anything unparseable falls
// back to the default rather than silently becoming unlimited.
const FREE_PLAN_WHISPER_LINKS_DEFAULT = 3;

function freePlanWhisperLinks(): number | null {
  const raw = process.env.FREE_PLAN_WHISPER_LINKS?.trim();
  if (!raw) return FREE_PLAN_WHISPER_LINKS_DEFAULT;
  if (raw.toLowerCase() === "unlimited") return null;
  return parsePositiveIntOr(raw, FREE_PLAN_WHISPER_LINKS_DEFAULT);
}

export const PLAN_LIMITS: Record<string, { whisperLinksPerMonth: number | null; monthlyBoostCredits: number }> = {
  free: { whisperLinksPerMonth: freePlanWhisperLinks(), monthlyBoostCredits: 0 },
  spark: { whisperLinksPerMonth: null, monthlyBoostCredits: 2 },
  ember: { whisperLinksPerMonth: null, monthlyBoostCredits: 5 },
};

export const GHOST_BOOST_COST_USD = 6.99;

// Ghost Boost is paused, not removed: the original idea was to buy reach on
// social ad platforms, which turned out not to be viable (no way to
// guarantee reaching one identified person, plus anti-harassment ad-policy
// risk), and the anonymous-mailing-list matching that replaced it hasn't
// proven itself either. The code, schema, tests, and historical
// data/campaigns all stay intact so this can be re-scoped and flipped back
// on later — this ONE flag is the single place that does it. Every other
// gate in the app (routes/whisps.ts's send block, routes/billing.ts's
// credit-pack checkout block, SendWhisp.tsx/CreditsPage.tsx/Dashboard.tsx's
// hidden UI) reads from this constant. Viewing/managing a PAST Ghost Boost
// campaign (WhispDetail.tsx's match-stats view, admin panel) is
// deliberately NOT gated by this — only new sends and new purchases are.
export const GHOST_BOOST_ENABLED = false;

// How many times an ANONYMOUS recipient can reply to a single whisp before
// the thread closes and the sender is offered more (whisps.
// replyCreditsPurchased). Overridable via RECIPIENT_FREE_REPLIES; set it to
// "unlimited" to disable the cap entirely.
//
// This only ever applies to anonymous recipients. Someone who signs up is
// never capped — the limit exists to make an unlimited anonymous back-and-
// forth a deliberate purchase (or a reason to join), not to ration
// conversation between members.
// TODO(payment): flip this back to 3 once the "buy more replies" purchase
// flow exists. The cap is OFF by default until then — deliberately, not by
// oversight. Capping recipients before there's any way to lift the cap
// leaves a sender staring at a dead thread with a disabled "coming soon"
// button, and it would keep interrupting testing. All the enforcement below
// (and the sender/recipient UI) is built and tested; it's a one-line change
// plus a redeploy when billing lands.
//
// Note this also parks a design question worth revisiting then: because the
// cap is skipped for signed-in callers, a sender who watches replies keep
// arriving past the allowance can infer their recipient created an account.
// Harmless while uncapped (no allowance is ever shown or enforced).
const RECIPIENT_FREE_REPLIES_DEFAULT = null;

export function recipientFreeReplies(): number | null {
  const raw = process.env.RECIPIENT_FREE_REPLIES?.trim();
  if (!raw) return RECIPIENT_FREE_REPLIES_DEFAULT;
  if (raw.toLowerCase() === "unlimited") return null;
  return parsePositiveIntOr(raw, RECIPIENT_FREE_REPLIES_DEFAULT ?? 3);
}

// Total anonymous replies allowed on a whisp: the free allowance plus
// whatever the sender bought for it. Null means uncapped.
export function recipientReplyAllowance(replyCreditsPurchased: number): number | null {
  const free = recipientFreeReplies();
  return free === null ? null : free + replyCreditsPurchased;
}

/**
 * Whether the recipient of this whisp may reply with a VIDEO.
 *
 * Text replies stay open to anonymous recipients (up to the reply allowance);
 * whisping a video back is the thing that needs either a membership or credit
 * the sender bought for this whisp. Two reasons it's drawn here rather than at
 * the reply cap: a video reply costs real storage and moderation attention in
 * a way a line of text doesn't, and it's the moment where asking an anonymous
 * recipient to join is a fair trade rather than an interruption — they're
 * already choosing to put something of their own into the exchange.
 *
 * Deliberately NOT tied to recipientFreeReplies: that cap is currently off
 * (see the TODO above), and this restriction is meant to hold regardless.
 */
export function canRecipientWhispVideoBack(isSignedIn: boolean, replyCreditsPurchased: number): boolean {
  return isSignedIn || replyCreditsPurchased > 0;
}

export function whisperLinkLimitFor(plan: string): number | null {
  return (PLAN_LIMITS[plan] ?? PLAN_LIMITS.free).whisperLinksPerMonth;
}

// How many public comments an ANONYMOUS (no account) visitor can post on an
// open, anonymous public comment thread — Blind Circle content and Debate
// Topics both use this same shared limit, and any future anonymous comment
// surface should call these same functions rather than growing a parallel
// rate-limit system — within a rolling window, before being asked to sign
// up or wait it out. Unlike recipientFreeReplies above, this ships enabled
// by default: these are brand-new, always-public surfaces with no existing
// "buy more" purchase flow to eventually gate behind, so there's no reason
// to launch uncapped the way the reply cap currently is. Overridable via
// ANONYMOUS_COMMENT_LIMIT ("unlimited" disables it), same pattern as every
// other configurable limit in this file.
const ANONYMOUS_COMMENT_LIMIT_DEFAULT = 3;
export const COMMENT_LIMIT_WINDOW_HOURS = 24;

export function anonymousCommentLimit(): number | null {
  const raw = process.env.ANONYMOUS_COMMENT_LIMIT?.trim();
  if (!raw) return ANONYMOUS_COMMENT_LIMIT_DEFAULT;
  if (raw.toLowerCase() === "unlimited") return null;
  return parsePositiveIntOr(raw, ANONYMOUS_COMMENT_LIMIT_DEFAULT);
}

/**
 * Whether this visitor may post another Circle comment right now.
 *
 * A signed-in caller is never capped — creating a free account ("becoming a
 * Whisperer") is exactly the way around this limit, same as the anonymous
 * reply cap's own signed-in exemption elsewhere in this file.
 * `recentCommentCount` is the caller's count of comments in the trailing
 * COMMENT_LIMIT_WINDOW_HOURS window (see routes/public.ts), not a lifetime
 * total — the limit resets on a rolling 24h basis, not a hard one-time wall.
 */
export function canPostAnonymousComment(isSignedIn: boolean, recentCommentCount: number): boolean {
  if (isSignedIn) return true;
  const limit = anonymousCommentLimit();
  return limit === null || recentCommentCount < limit;
}
