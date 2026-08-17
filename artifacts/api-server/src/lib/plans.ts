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
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : FREE_PLAN_WHISPER_LINKS_DEFAULT;
}

export const PLAN_LIMITS: Record<string, { whisperLinksPerMonth: number | null; monthlyBoostCredits: number }> = {
  free: { whisperLinksPerMonth: freePlanWhisperLinks(), monthlyBoostCredits: 0 },
  spark: { whisperLinksPerMonth: null, monthlyBoostCredits: 2 },
  ember: { whisperLinksPerMonth: null, monthlyBoostCredits: 5 },
};

export const GHOST_BOOST_COST_USD = 6.99;

export function whisperLinkLimitFor(plan: string): number | null {
  return (PLAN_LIMITS[plan] ?? PLAN_LIMITS.free).whisperLinksPerMonth;
}
