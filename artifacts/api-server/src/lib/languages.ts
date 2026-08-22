// The languages Blind Whisper supports end-to-end. ISO 639-1 codes.
// Mirrored by hand in artifacts/blindwhisper/src/lib/languages.ts, same
// "kept in sync by hand" pattern as GENDER_OPTIONS/VIDEO_CATEGORIES
// elsewhere in this app.
//
// Only languages with a real, full translation set belong here — the list
// once carried 14, but the 6 with empty stub locale directories rendered
// English no matter what the user picked, which reads as "translation is
// broken" rather than "not offered yet." Re-adding one means translating
// every frontend namespace file first, then restoring it here AND in the
// frontend mirror together. A language missing an individual string still
// falls back to English string-by-string, never to a blank space.
export const SUPPORTED_LANGUAGES = ["en", "fr", "ar", "de", "es", "zh", "sw", "ko"] as const;
export type LanguageCode = (typeof SUPPORTED_LANGUAGES)[number];

// Right-to-left languages — the one language in this list needing layout
// mirroring, not just translated strings.
export const RTL_LANGUAGES: readonly LanguageCode[] = ["ar"];

export function isSupportedLanguage(value: string): value is LanguageCode {
  return (SUPPORTED_LANGUAGES as readonly string[]).includes(value);
}
