// Self-reported, optional-to-decline demographic buckets — collected once,
// right before a user's first whisp send (see the gate in routes/whisps.ts
// and routes/whisperGroups.ts), purely for "who is Whispering the most"
// analytics (see routes/admin.ts's GET /stats/demographics). Kept as a
// small fixed set on both ends (mirrored in
// artifacts/blindwhisper/src/lib/demographics.ts, the same "kept in sync by
// hand" pattern as VIDEO_CATEGORIES/HOOK_LINE) rather than free text, so
// analytics stays a simple group-by instead of fuzzy-matching user input.
export const GENDER_OPTIONS = ["woman", "man", "nonbinary", "prefer_not_to_say"] as const;
export type Gender = (typeof GENDER_OPTIONS)[number];

export const AGE_RANGE_OPTIONS = ["13-17", "18-24", "25-34", "35-44", "45-54", "55-64", "65+", "prefer_not_to_say"] as const;
export type AgeRange = (typeof AGE_RANGE_OPTIONS)[number];

// True until both fields have been answered once — "prefer_not_to_say" is a
// real answer that satisfies the gate just like any other option, this only
// checks for "never asked."
export function needsDemographics(user: { gender: string | null; ageRange: string | null }): boolean {
  return !user.gender || !user.ageRange;
}
