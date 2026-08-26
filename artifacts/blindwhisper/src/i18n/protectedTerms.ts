// Product/brand terms that stay in English (or however the brand itself
// styles them) in every translation, never localized — the product ask
// behind this whole i18n effort was "100% translation... unless key and
// exceptional words such as Whisp." Every translation namespace file
// (src/i18n/locales/<lang>/*.json) must leave these exact strings alone
// wherever they appear inside a longer sentence, and every future
// extraction pass should route feature/product names through here rather
// than hand-typing them again elsewhere.
export const PROTECTED_TERMS = [
  "Blind Whisper",
  "Whisp",
  "Whisps",
  "Whisper Link",
  "Whisper Links",
  "Ghost Boost",
  "Whisperer",
  "Whisperers",
  "Blind Circle",
  "Blind Circles",
  "Debate Now",
  "Debado",
  "Circle Scout",
  "Intelo",
] as const;
