import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { SUPPORTED_LANGUAGES, RTL_LANGUAGES } from "@/lib/languages";

// Auto-discovers every locale/namespace JSON file instead of listing them
// by hand — adding a new namespace (e.g. src/i18n/locales/en/whisp.json +
// its siblings in every other language directory) is enough on its own,
// nothing here needs to change. This also means multiple people/agents
// extracting different areas of the app into their own namespace never
// have to touch this file, so there's nothing to merge-conflict over.
const modules = import.meta.glob("./locales/*/*.json", { eager: true }) as Record<string, { default: Record<string, unknown> }>;

const resources: Record<string, Record<string, Record<string, unknown>>> = {};
const namespaces = new Set<string>();
for (const [path, mod] of Object.entries(modules)) {
  const match = path.match(/\.\/locales\/([^/]+)\/([^/]+)\.json$/);
  if (!match) continue;
  const [, lang, ns] = match;
  resources[lang] ??= {};
  resources[lang][ns] = mod.default;
  namespaces.add(ns);
}

void i18n.use(initReactI18next).init({
  resources,
  lng: "en",
  fallbackLng: "en",
  defaultNS: "common",
  ns: [...namespaces],
  supportedLngs: [...SUPPORTED_LANGUAGES],
  interpolation: { escapeValue: false },
  // Never throw/log-spam over a key that isn't translated yet in a given
  // language — that's the expected, common state during rollout (see
  // languages.ts's phased-coverage comment), not a bug to surface loudly.
  returnEmptyString: false,
  saveMissing: false,
});

// Keep the document's direction (and lang attribute) in step with the
// active language — Arabic strings rendered LTR are half-broken no matter
// how good the translation is. Guarded for non-browser contexts: this
// module also loads under Node during the build's prerender pass (see
// scripts/prerender.mjs), where there's no document to flip.
i18n.on("languageChanged", (lng) => {
  if (typeof document === "undefined") return;
  document.documentElement.dir = (RTL_LANGUAGES as readonly string[]).includes(lng) ? "rtl" : "ltr";
  document.documentElement.lang = lng;
});

export default i18n;
