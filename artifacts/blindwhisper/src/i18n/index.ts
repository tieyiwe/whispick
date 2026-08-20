import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { SUPPORTED_LANGUAGES } from "@/lib/languages";

// Each language's "common" namespace (nav/shared-shell strings) — every
// entry here MUST exist as a file even before it's translated (see the
// locales/<lang>/common.json files this pairs with): an empty `{}` is a
// real, valid state meaning "not translated yet, fall back to English,"
// never a missing import. Add a new namespace by adding both a JSON file
// per language AND a resources[lang].<namespace> entry below — nothing
// else needs to change, i18next resolves the rest by key.
import enCommon from "./locales/en/common.json";
import esCommon from "./locales/es/common.json";
import swCommon from "./locales/sw/common.json";
import frCommon from "./locales/fr/common.json";
import deCommon from "./locales/de/common.json";
import zhCommon from "./locales/zh/common.json";
import koCommon from "./locales/ko/common.json";
import arCommon from "./locales/ar/common.json";
import ptCommon from "./locales/pt/common.json";
import jaCommon from "./locales/ja/common.json";
import hiCommon from "./locales/hi/common.json";
import ruCommon from "./locales/ru/common.json";
import idCommon from "./locales/id/common.json";
import bnCommon from "./locales/bn/common.json";

void i18n.use(initReactI18next).init({
  resources: {
    en: { common: enCommon },
    es: { common: esCommon },
    sw: { common: swCommon },
    fr: { common: frCommon },
    de: { common: deCommon },
    zh: { common: zhCommon },
    ko: { common: koCommon },
    ar: { common: arCommon },
    pt: { common: ptCommon },
    ja: { common: jaCommon },
    hi: { common: hiCommon },
    ru: { common: ruCommon },
    id: { common: idCommon },
    bn: { common: bnCommon },
  },
  lng: "en",
  fallbackLng: "en",
  defaultNS: "common",
  ns: ["common"],
  supportedLngs: [...SUPPORTED_LANGUAGES],
  interpolation: { escapeValue: false },
  // Never throw/log-spam over a key that isn't translated yet in a given
  // language — that's the expected, common state during rollout (see
  // languages.ts's phased-coverage comment), not a bug to surface loudly.
  returnEmptyString: false,
  saveMissing: false,
});

export default i18n;
