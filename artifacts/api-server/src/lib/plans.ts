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

// How many times an ANONYMOUS recipient can reply to a single whisp before
// the thread closes and the sender is offered more (whisps.
// replyCreditsPurchased). Overridable via RECIPIENT_FREE_REPLIES; set it to
// "unlimited" to disable the cap entirely.
//
// This only ever applies to anonymous recipients. Someone who signs up is
// never capped — the limit exists to make an unlimited anonymous back-and-
// forth a deliberate purchase (or a reason to join), not to ration
// conversation between members.
const RECIPIENT_FREE_REPLIES_DEFAULT = 3;

export function recipientFreeReplies(): number | null {
  const raw = process.env.RECIPIENT_FREE_REPLIES?.trim();
  if (!raw) return RECIPIENT_FREE_REPLIES_DEFAULT;
  if (raw.toLowerCase() === "unlimited") return null;
  return parsePositiveIntOr(raw, RECIPIENT_FREE_REPLIES_DEFAULT);
}

// Total anonymous replies allowed on a whisp: the free allowance plus
// whatever the sender bought for it. Null means uncapped.
export function recipientReplyAllowance(replyCreditsPurchased: number): number | null {
  const free = recipientFreeReplies();
  return free === null ? null : free + replyCreditsPurchased;
}

export function whisperLinkLimitFor(plan: string): number | null {
  return (PLAN_LIMITS[plan] ?? PLAN_LIMITS.free).whisperLinksPerMonth;
}
