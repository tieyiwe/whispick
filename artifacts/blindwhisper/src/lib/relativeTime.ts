import i18n from "@/i18n";

// Locale-aware "5 minutes ago" / "5 days" for every UI language. Goes
// through Intl rather than date-fns: date-fns needs a locale object per
// language (and has none for Swahili), while Intl ships CLDR data for all
// of them — including the grammar, e.g. German "vor 5 Tagen" (dative) and
// Arabic dual/plural forms, which a translated "{{time}} ago" template
// wrapped around an English duration can't get right.
//
// Unit choice mirrors date-fns' formatDistanceToNowStrict: the largest unit
// that keeps the value >= 1, rounded.
const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 365 * 86_400],
  ["month", 30 * 86_400],
  ["day", 86_400],
  ["hour", 3_600],
  ["minute", 60],
  ["second", 1],
];

function pickUnit(seconds: number): [Intl.RelativeTimeFormatUnit, number] {
  const abs = Math.abs(seconds);
  for (const [unit, size] of UNITS) {
    if (abs >= size) return [unit, Math.round(abs / size)];
  }
  return ["second", 0];
}

function currentLocale(): string | undefined {
  return i18n.resolvedLanguage ?? i18n.language ?? undefined;
}

function toMs(value: Date | string | number): number {
  return value instanceof Date ? value.getTime() : typeof value === "number" ? value : new Date(value).getTime();
}

/** "5 minutes ago", "vor 5 Tagen", "il y a 3 heures", "5分钟前", "yesterday"… */
export function formatTimeAgo(value: Date | string | number, locale = currentLocale()): string {
  const [unit, amount] = pickUnit((Date.now() - toMs(value)) / 1000);
  try {
    return new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(-amount, unit);
  } catch {
    return new Intl.RelativeTimeFormat("en", { numeric: "auto" }).format(-amount, unit);
  }
}

/**
 * A bare duration until `value` — "5 days", "3 Stunden", "5天" — for
 * templates like "Expires in {{time}}". Phrase those templates so the
 * duration reads in its plain (nominative) form in every language.
 */
export function formatDurationUntil(value: Date | string | number, locale = currentLocale()): string {
  const [unit, amount] = pickUnit((toMs(value) - Date.now()) / 1000);
  const opts: Intl.NumberFormatOptions = { style: "unit", unit, unitDisplay: "long" };
  try {
    return new Intl.NumberFormat(locale, opts).format(amount);
  } catch {
    return new Intl.NumberFormat("en", opts).format(amount);
  }
}
