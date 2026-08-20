// Mirrors artifacts/api-server/src/lib/languages.ts — kept in sync by hand,
// same pattern as GENDER_OPTIONS/VIDEO_CATEGORIES elsewhere in this app.
export const SUPPORTED_LANGUAGES = ["en", "fr", "ar", "de", "es", "pt", "zh", "ja", "hi", "ru", "id", "bn", "sw"] as const;
export type LanguageCode = (typeof SUPPORTED_LANGUAGES)[number];

export const RTL_LANGUAGES: readonly LanguageCode[] = ["ar"];

// Each language's own name, in its own script — not translated into
// whatever language the picker happens to be shown in, so a speaker of
// that language can always recognize their own option regardless of what
// language the UI currently renders in.
export const LANGUAGE_LABELS: Record<LanguageCode, string> = {
  en: "English",
  fr: "Français",
  ar: "العربية",
  de: "Deutsch",
  es: "Español",
  pt: "Português",
  zh: "中文",
  ja: "日本語",
  hi: "हिन्दी",
  ru: "Русский",
  id: "Bahasa Indonesia",
  bn: "বাংলা",
  sw: "Kiswahili",
};

export function isSupportedLanguage(value: string | null | undefined): value is LanguageCode {
  return !!value && (SUPPORTED_LANGUAGES as readonly string[]).includes(value);
}

// Best-effort guess from the browser's own language setting, for
// pre-selecting (never auto-confirming) an option in the onboarding gate —
// the user still has to explicitly pick and confirm. Falls back to English
// when the browser reports something outside the supported set.
export function guessBrowserLanguage(): LanguageCode {
  const raw = typeof navigator !== "undefined" ? navigator.language : "en";
  const base = raw.split("-")[0].toLowerCase();
  return isSupportedLanguage(base) ? base : "en";
}
