import { getCountries, getCountryCallingCode } from "libphonenumber-js/min";

export type CountryOption = {
  iso2: string;
  name: string;
  dialCode: string;
};

// Country names come from the browser's own locale data (Intl.DisplayNames)
// rather than a hand-maintained list — always accurate/localized, zero extra
// bundle weight. Dial codes come from libphonenumber-js, the same library
// the backend uses to normalize phone numbers (lib/phone.ts's
// normalizePhoneE164), so a country picked here always maps to a dial code
// the server will parse the same way.
const regionNames = new Intl.DisplayNames(["en"], { type: "region" });

export const COUNTRIES: CountryOption[] = getCountries()
  .map((iso2) => ({
    iso2,
    name: regionNames.of(iso2) ?? iso2,
    dialCode: getCountryCallingCode(iso2),
  }))
  .sort((a, b) => a.name.localeCompare(b.name));

// Regional indicator symbols — the standard way to render a flag emoji from
// an ISO 3166-1 alpha-2 code with no image assets or extra data needed.
export function flagEmoji(iso2: string): string {
  return String.fromCodePoint(...[...iso2.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}

// Best-effort default country from the browser's own locale, so most people
// never have to touch the picker at all. Falls back to the US, matching
// this app's primary market.
//
// Defensive: navigator.language isn't always a valid BCP 47 tag (empty in
// some headless/in-app browsers, POSIX-style "en_US" in some WebViews), and
// `new Intl.Locale` THROWS on those — which took down every page that
// renders a phone field (dashboard, settings, welcome) via the error
// boundary instead of just defaulting the picker.
export function detectDefaultCountry(): string {
  for (const tag of [navigator.language, ...(navigator.languages ?? [])]) {
    try {
      const region = new Intl.Locale(String(tag).replace(/_/g, "-")).maximize().region;
      if (region && COUNTRIES.some((c) => c.iso2 === region)) return region;
    } catch {
      // Not a usable tag — try the next one.
    }
  }
  return "US";
}
