// The 13 languages Blind Whisper supports end-to-end: the top 12 world
// languages by total speakers, plus Swahili (explicitly requested — most
// apps' "top N" lists skip it despite its huge East African reach). ISO
// 639-1 codes. Mirrored by hand in
// artifacts/blindwhisper/src/lib/languages.ts, same "kept in sync by hand"
// pattern as GENDER_OPTIONS/VIDEO_CATEGORIES elsewhere in this app.
//
// Rollout is phased (see replit.md): the pipeline (this list, the
// onboarding capture gate, the notification/email translation system) ships
// for all 13 up front, but full UI-string translation coverage starts with
// English/Spanish/Swahili and fills in the rest afterward. A language
// missing full coverage falls back to English string-by-string, never to a
// blank space.
export const SUPPORTED_LANGUAGES = ["en", "fr", "ar", "de", "es", "pt", "zh", "ja", "hi", "ru", "id", "bn", "sw"] as const;
export type LanguageCode = (typeof SUPPORTED_LANGUAGES)[number];

// Right-to-left languages — the one language in this list needing layout
// mirroring, not just translated strings.
export const RTL_LANGUAGES: readonly LanguageCode[] = ["ar"];

export function isSupportedLanguage(value: string): value is LanguageCode {
  return (SUPPORTED_LANGUAGES as readonly string[]).includes(value);
}
