import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { SUPPORTED_LANGUAGES } from "@/lib/languages";

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

export default i18n;
