export const PLAN_LIMITS: Record<string, { whisperLinksPerMonth: number | null; monthlyBoostCredits: number }> = {
  free: { whisperLinksPerMonth: 3, monthlyBoostCredits: 0 },
  spark: { whisperLinksPerMonth: null, monthlyBoostCredits: 2 },
  ember: { whisperLinksPerMonth: null, monthlyBoostCredits: 5 },
};

export const GHOST_BOOST_COST_USD = 6.99;

export function whisperLinkLimitFor(plan: string): number | null {
  return (PLAN_LIMITS[plan] ?? PLAN_LIMITS.free).whisperLinksPerMonth;
}
