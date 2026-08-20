import { isSupportedLanguage } from "./languages";

// Mirrors artifacts/api-server/src/lib/demographics.ts — kept in sync by
// hand, same pattern as VIDEO_CATEGORIES/HOOK_LINE elsewhere in this app.
export const GENDER_OPTIONS = ["woman", "man", "nonbinary", "prefer_not_to_say"] as const;
export type Gender = (typeof GENDER_OPTIONS)[number];

export const GENDER_LABELS: Record<Gender, string> = {
  woman: "Woman",
  man: "Man",
  nonbinary: "Non-binary",
  prefer_not_to_say: "Prefer not to say",
};

export const AGE_RANGE_OPTIONS = ["13-17", "18-24", "25-34", "35-44", "45-54", "55-64", "65+", "prefer_not_to_say"] as const;
export type AgeRange = (typeof AGE_RANGE_OPTIONS)[number];

export const AGE_RANGE_LABELS: Record<AgeRange, string> = {
  "13-17": "13–17",
  "18-24": "18–24",
  "25-34": "25–34",
  "35-44": "35–44",
  "45-54": "45–54",
  "55-64": "55–64",
  "65+": "65+",
  prefer_not_to_say: "Prefer not to say",
};

// True until gender, ageRange, AND preferredLanguage have all been answered
// once — matches the backend gate in POST /whisps and POST /whisper-groups/
// :id/send exactly, so the frontend can decide to show the confirmation
// step before even attempting a send instead of only reacting to the 428
// it'd otherwise get back.
export function needsDemographics(
  profile: { gender?: string | null; ageRange?: string | null; preferredLanguage?: string | null } | undefined | null,
): boolean {
  if (!profile) return false; // profile not loaded yet — let the real send attempt surface it
  return !profile.gender || !profile.ageRange || !isSupportedLanguage(profile.preferredLanguage);
}
