import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { Resvg } from "@resvg/resvg-js";
import sharp from "sharp";

// satori is loaded through its CommonJS build on purpose: the ESM build's
// embedded harfbuzz reads a bare `__dirname`, which only exists inside the
// esbuild bundle (build.mjs's banner defines it) — under vitest or plain
// Node ESM the import rejects. A local createRequire also keeps esbuild
// from bundling it, so it resolves from node_modules like sharp does.
const nodeRequire = createRequire(import.meta.url);
type Satori = typeof import("satori").default;
let satoriFn: Satori | null = null;
function getSatori(): Satori {
  satoriFn ??= (nodeRequire("satori") as { default: Satori }).default;
  return satoriFn;
}

// Generated 1200×630 Open Graph cards for every shareable link (served by
// routes/og.ts). satori lays out a plain-object element tree and turns text
// into SVG paths; resvg rasterizes that SVG to PNG; sharp re-encodes it as a
// palette PNG, because a raw RGBA render of these soft gradients is several
// hundred KB and WhatsApp silently drops an og:image over ~300 KB.

export const OG_WIDTH = 1200;
export const OG_HEIGHT = 630;

const COLORS = {
  background: "#0D0D1A",
  violet: "#7C5CFC",
  violetLight: "#9B7BFF",
  // --gilded (hsl 43 73% 67%) and --aqua (hsl 180 72% 62%) from the
  // frontend's index.css — the logo's pulse runs violet → aqua → gold.
  gilded: "#E8C86E",
  aqua: "#5CE0E0",
  text: "#F4F1FF",
  muted: "#B4ADD6",
  faint: "#8A84AD",
};

// Mood colors from the frontend's MoodTag.tsx MOOD_CONFIG. A mood only tints
// the glow — it's never named on the card (that would read as a hint about
// the message to everyone else in a group chat).
export const MOOD_GLOW: Record<string, string> = {
  "i-see-you": "#F59E0B",
  "heal-together": "#3B82F6",
  "i-love-you": "#EC4899",
  "think-about-this": "#10B981",
  "for-your-growth": "#8B5CF6",
  "just-because": "#D4B896",
};

export type OgCard = {
  /** Small uppercase label above the headline. */
  eyebrow: string;
  headline: string;
  /** Optional second headline line in gold italic. */
  accent?: string;
  sub?: string;
  /** Rounded call-to-action chip under the headline. */
  pill?: string;
  /** Small text beside the pill (e.g. an answer count). */
  meta?: string;
  /** Secondary glow color (bottom-right). Defaults to aqua. */
  glow?: string;
};

type FontDef = { name: string; data: Buffer; weight: 400 | 600 | 700; style: "normal" | "italic" };

let fontsPromise: Promise<FontDef[]> | null = null;

// Loaded once, lazily — the first card pays ~10ms of file reads, nothing at
// boot. Each family is registered under one name across several unicode
// subsets: satori picks, per glyph, the first registered font that has it,
// so a debate question in Spanish, German, Vietnamese or Russian still
// renders in-brand.
function loadFonts(): Promise<FontDef[]> {
  fontsPromise ??= (async () => {
    const file = (pkg: string, name: string) => readFileSync(nodeRequire.resolve(`${pkg}/files/${name}`));
    const defs: FontDef[] = [];
    for (const subset of ["latin", "latin-ext", "cyrillic", "vietnamese"]) {
      defs.push({ name: "Playfair", data: file("@fontsource/playfair-display", `playfair-display-${subset}-700-normal.woff`), weight: 700, style: "normal" });
    }
    defs.push({ name: "Playfair", data: file("@fontsource/playfair-display", "playfair-display-latin-700-italic.woff"), weight: 700, style: "italic" });
    for (const subset of ["latin", "latin-ext", "cyrillic", "greek", "vietnamese"]) {
      for (const weight of [400, 600] as const) {
        defs.push({ name: "Inter", data: file("@fontsource/inter", `inter-${subset}-${weight}-normal.woff`), weight, style: "normal" });
      }
    }
    return defs;
  })().catch((err) => {
    fontsPromise = null; // let the next request retry rather than caching the failure
    throw err;
  });
  return fontsPromise;
}

// Scripts the bundled fonts cover: Latin (+ext, Vietnamese), Greek, Cyrillic
// and common punctuation/symbols. Anything else (Arabic, CJK, Hangul, ...)
// would render as blank boxes, so callers check this and fall back to a
// generic headline instead of a broken card.
const UNSUPPORTED_CHAR = /[^\u0000-ԯḀ-῿ -⁯₠-⃏℀-⅏←-⇿∀-⋿]/u;

// Emoji have no glyphs in these fonts either; strip them (and the joiners /
// variation selectors that glue them together) rather than draw tofu.
const EMOJI = /[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{1F3FB}-\u{1F3FF}‍︎️⃣]/gu;

export function cleanCardText(text: string): string {
  return text.replace(EMOJI, "").replace(/\s+/g, " ").trim();
}

export function isRenderableText(text: string): boolean {
  return !UNSUPPORTED_CHAR.test(cleanCardText(text));
}

function clampText(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

const HEADLINE_WIDTH = 820;
// Playfair Display bold averages ~0.45em per glyph (measured on rendered
// samples); a little slack covers what word wrapping wastes.
const AVG_GLYPH_EM = 0.48;

// Biggest headline size whose estimated wrap fits the line budget; below the
// smallest size the text is cut (at a word) to what that size can hold.
// lineClamp in the layout is the hard backstop if wide glyphs beat the
// estimate.
function fitHeadline(text: string, accent: string, maxLines: number, maxSize: number): { size: number; text: string } {
  const sizes = [84, 74, 64, 56, 50, 44].filter((size) => size <= maxSize);
  const lines = (t: string, perLine: number) => (t ? Math.ceil(t.length / perLine) : 0);
  for (const size of sizes) {
    const perLine = Math.floor(HEADLINE_WIDTH / (size * AVG_GLYPH_EM));
    if (lines(text, perLine) + lines(accent, perLine) <= maxLines) return { size, text };
  }
  const size = sizes[sizes.length - 1];
  const perLine = Math.floor(HEADLINE_WIDTH / (size * AVG_GLYPH_EM));
  // ~90% of the raw capacity: word wrapping wastes the end of each line.
  const capacity = Math.floor(perLine * Math.max(1, maxLines - lines(accent, perLine)) * 0.9);
  if (text.length <= capacity) return { size, text };
  const cut = text.slice(0, capacity);
  const atWord = cut.slice(0, Math.max(cut.lastIndexOf(" "), capacity - 12)).replace(/[\s,;:.!?-]+$/, "");
  return { size, text: `${atWord}…` };
}

type El = { type: string; props: Record<string, unknown> & { style?: Record<string, unknown>; children?: unknown } };
const el = (type: string, style: Record<string, unknown>, children?: unknown, extra: Record<string, unknown> = {}): El => ({
  type,
  props: { style, children, ...extra },
});

const svgUri = (svg: string) => `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;

// The favicon's ear + sound-arc mark (artifacts/blindwhisper/public/favicon.svg),
// without its tile background.
const LOGO_PATHS = (earWidth: number, arcWidth: number) =>
  `<g fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M118,80 C145,80 158,105 154,130 C151,150 135,155 128,170 C122,183 130,196 122,204 C114,210 104,202 106,190 C108,180 98,178 95,165 C90,145 96,120 108,100 C111,93 113,86 118,80 Z" stroke="#9B7BFF" stroke-width="${earWidth}"/><path d="M167,138 A38,38 0 0,1 167,192" stroke="#7B61FF" stroke-width="${arcWidth}" opacity="0.9"/></g>`;
const LOGO_URI = svgUri(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="86 72 128 140">${LOGO_PATHS(12, 10)}</svg>`);

// The card's signature motif, drawn as one full-bleed SVG behind the text:
// the logo's ear on the right, its sound arc echoed outward as rings
// (violet → accent → gold, like the logo's pulse), over a soft glow in the
// card's accent color.
function backdropUri(glow: string): string {
  const cx = 1060;
  const cy = 300;
  const rings = [
    { r: 120, color: COLORS.violetLight, o: 0.5, w: 2.5 },
    { r: 190, color: COLORS.violet, o: 0.4, w: 2 },
    { r: 270, color: glow, o: 0.32, w: 2 },
    { r: 360, color: COLORS.gilded, o: 0.2, w: 1.5 },
    { r: 460, color: COLORS.violet, o: 0.12, w: 1.5 },
  ]
    .map((ring) => `<circle cx="${cx}" cy="${cy}" r="${ring.r}" fill="none" stroke="${ring.color}" stroke-opacity="${ring.o}" stroke-width="${ring.w}"/>`)
    .join("");
  // Ear mark is ~128×140 in its own units; scale ×1.0 and centre it on the rings.
  const logo = `<g transform="translate(${cx - 150},${cy - 142})">${LOGO_PATHS(9, 8)}</g>`;
  return svgUri(`<svg xmlns="http://www.w3.org/2000/svg" width="${OG_WIDTH}" height="${OG_HEIGHT}" viewBox="0 0 ${OG_WIDTH} ${OG_HEIGHT}">
<defs>
<radialGradient id="tl" cx="0.08" cy="0.05" r="0.75"><stop offset="0" stop-color="${COLORS.violet}" stop-opacity="0.42"/><stop offset="1" stop-color="${COLORS.violet}" stop-opacity="0"/></radialGradient>
<radialGradient id="hl" cx="${cx}" cy="${cy}" r="330" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${glow}" stop-opacity="0.30"/><stop offset="0.45" stop-color="${COLORS.violet}" stop-opacity="0.12"/><stop offset="1" stop-color="${COLORS.violet}" stop-opacity="0"/></radialGradient>
</defs>
<rect width="100%" height="100%" fill="url(#tl)"/>
<rect width="100%" height="100%" fill="url(#hl)"/>
${rings}${logo}
</svg>`);
}

// Glue the last two words together so a wrap never strands one short word
// ("you.") alone on the final line.
function noOrphan(text: string): string {
  const i = text.lastIndexOf(" ");
  return i > 0 && text.split(" ").length > 3 ? `${text.slice(0, i)}\u00A0${text.slice(i + 1)}` : text;
}

function cardTree(card: OgCard): El {
  const glow = card.glow ?? COLORS.aqua;
  // Vertical budget: four headline lines, one fewer for each extra row.
  const maxLines = 4 - (card.sub ? 1 : 0) - (card.pill || card.meta ? 1 : 0);
  const accent = card.accent ? cleanCardText(card.accent) : "";
  // The pill row is taller than a line of sub text; a full-size 3-line
  // headline above it would crowd the footer.
  const maxSize = card.pill ? 74 : 84;
  const { size, text: headline } = fitHeadline(clampText(cleanCardText(card.headline), 240), accent, maxLines, maxSize);

  const textColumn: El[] = [
    el(
      "div",
      { display: "flex", alignItems: "center", marginBottom: 30 },
      [
        el("div", { width: 34, height: 2, backgroundColor: COLORS.gilded, marginRight: 16 }),
        el("div", { fontFamily: "Inter", fontWeight: 600, fontSize: 20, letterSpacing: 5, color: COLORS.gilded, textTransform: "uppercase" }, card.eyebrow),
      ],
    ),
    el(
      "div",
      {
        display: "block",
        fontFamily: "Playfair",
        fontWeight: 700,
        fontSize: size,
        lineHeight: 1.12,
        color: COLORS.text,
        maxWidth: HEADLINE_WIDTH,
        lineClamp: maxLines,
      },
      noOrphan(headline),
    ),
  ];
  if (card.accent) {
    textColumn.push(
      el("div", { fontFamily: "Playfair", fontStyle: "italic", fontWeight: 700, fontSize: size, lineHeight: 1.12, color: COLORS.gilded, maxWidth: HEADLINE_WIDTH }, noOrphan(accent)),
    );
  }
  if (card.sub) {
    textColumn.push(
      el("div", { fontFamily: "Inter", fontWeight: 400, fontSize: 30, lineHeight: 1.4, color: COLORS.muted, marginTop: 28, maxWidth: HEADLINE_WIDTH, lineClamp: 1 }, cleanCardText(card.sub)),
    );
  }
  if (card.pill || card.meta) {
    const row: El[] = [];
    if (card.pill) {
      row.push(
        el(
          "div",
          {
            display: "flex",
            alignItems: "center",
            padding: "14px 28px",
            borderRadius: 999,
            backgroundColor: COLORS.violet,
            color: "#FFFFFF",
            fontFamily: "Inter",
            fontWeight: 600,
            fontSize: 26,
            boxShadow: `0 8px 32px ${COLORS.violet}66`,
          },
          card.pill,
        ),
      );
    }
    if (card.meta) {
      row.push(el("div", { fontFamily: "Inter", fontWeight: 600, fontSize: 24, color: COLORS.muted, marginLeft: card.pill ? 24 : 0 }, card.meta));
    }
    textColumn.push(el("div", { display: "flex", alignItems: "center", marginTop: 36 }, row));
  }

  return el(
    "div",
    {
      width: OG_WIDTH,
      height: OG_HEIGHT,
      display: "flex",
      flexDirection: "column",
      position: "relative",
      backgroundColor: COLORS.background,
      padding: "64px 72px 56px",
    },
    [
      el("img", { position: "absolute", top: 0, left: 0, width: OG_WIDTH, height: OG_HEIGHT }, undefined, { src: backdropUri(glow), width: OG_WIDTH, height: OG_HEIGHT }),
      el("div", { display: "flex", flexDirection: "column", justifyContent: "center", flexGrow: 1 }, textColumn),
      el(
        "div",
        { display: "flex", alignItems: "center", justifyContent: "space-between" },
        [
          el("div", { display: "flex", alignItems: "center" }, [
            el("img", { width: 32, height: 35, marginRight: 12 }, undefined, { src: LOGO_URI, width: 32, height: 35 }),
            el("div", { fontFamily: "Playfair", fontWeight: 700, fontSize: 30, color: COLORS.text }, "Blind Whisper"),
          ]),
          el("div", { fontFamily: "Inter", fontWeight: 600, fontSize: 20, letterSpacing: 3, color: COLORS.faint, textTransform: "uppercase" }, "100% anonymous"),
        ],
      ),
    ],
  );
}

export async function renderOgPng(card: OgCard): Promise<Buffer> {
  const fonts = await loadFonts();
  const satori = getSatori();
  const svg = await satori(cardTree(card) as unknown as Parameters<Satori>[0], { width: OG_WIDTH, height: OG_HEIGHT, fonts });
  const raw = new Resvg(svg, { fitTo: { mode: "width", value: OG_WIDTH }, font: { loadSystemFonts: false } }).render().asPng();
  // Palette PNG with dithering: ~5-10× smaller than the RGBA render, and the
  // dither keeps the radial glows from banding.
  return sharp(raw).png({ palette: true, colours: 256, dither: 1, compressionLevel: 9, effort: 8 }).toBuffer();
}

// ── Card presets ─────────────────────────────────────────────────────────
// Copy is curiosity-first and never identifying: no sender, no recipient
// contact, no video title or thumbnail, no note text.

export const OG_CARDS = {
  default: (): OgCard => ({
    eyebrow: "Anonymous & honest",
    headline: "Send what they need to hear.",
    accent: "Without making it weird.",
    sub: "Anonymous videos and notes, sent with care.",
  }),
  whisp: (mood?: string): OgCard => ({
    eyebrow: "A whisp for you",
    headline: "Someone has something to tell you.",
    sub: "Sent anonymously. Open it to find out what.",
    glow: (mood && MOOD_GLOW[mood]) || COLORS.aqua,
  }),
  textwhisp: (): OgCard => ({
    eyebrow: "A note for you",
    headline: "Someone wrote you a note.",
    sub: "Sent anonymously. Open it to read what they said.",
    glow: COLORS.gilded,
  }),
  invite: (): OgCard => ({
    eyebrow: "You're invited",
    headline: "Someone thinks you should be here.",
    sub: "Find out what it's about — anonymously.",
  }),
  circle: (): OgCard => ({
    eyebrow: "Blind Circle",
    headline: "Someone shared this anonymously.",
    sub: "See what it is — and join the conversation.",
  }),
  whisperbox: (handle: string): OgCard => ({
    eyebrow: "Whisper Box",
    // The handle is one unbreakable word; giving the rest its own (accent)
    // line keeps a long handle from stranding "an" on a line by itself.
    headline: `Send @${handle}`,
    accent: "an anonymous message.",
    sub: "They'll never know it was you. No account needed.",
  }),
  debate: (question: string | null, answers: number): OgCard => ({
    eyebrow: "Debate Now",
    headline: question && isRenderableText(question) ? question : "A new debate is waiting for your answer.",
    pill: "Answer 100% anonymously",
    meta: answers > 0 ? `${answers} ${answers === 1 ? "answer" : "answers"} so far` : undefined,
  }),
  debateHub: (): OgCard => ({
    eyebrow: "Debate Now",
    headline: "Real questions. Honest answers.",
    accent: "Nobody knows who said what.",
    pill: "Answer 100% anonymously",
  }),
};

// ── Rendered-PNG cache ───────────────────────────────────────────────────
// A render is ~150-400ms of CPU, and crawlers re-fetch the same card for
// every share of a link, so finished PNGs are kept in a small LRU (a Map
// iterates in insertion order; re-inserting on a hit moves an entry to the
// back). Concurrent requests for the same card share one render.

const CACHE_MAX_ENTRIES = 200;
const cache = new Map<string, { png: Buffer; expiresAt: number }>();
const inFlight = new Map<string, Promise<Buffer>>();

export async function getOgPng(key: string, ttlMs: number, build: () => OgCard): Promise<Buffer> {
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) {
    cache.delete(key);
    cache.set(key, hit);
    return hit.png;
  }
  const pending = inFlight.get(key);
  if (pending) return pending;

  const render = renderOgPng(build())
    .then((png) => {
      cache.delete(key);
      cache.set(key, { png, expiresAt: Date.now() + ttlMs });
      while (cache.size > CACHE_MAX_ENTRIES) cache.delete(cache.keys().next().value!);
      return png;
    })
    .finally(() => inFlight.delete(key));
  inFlight.set(key, render);
  return render;
}

export function clearOgCacheForTests(): void {
  cache.clear();
}
