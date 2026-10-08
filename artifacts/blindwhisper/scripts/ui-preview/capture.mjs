#!/usr/bin/env node
// DEV-ONLY: screenshot the Blind Whisper app with a mocked backend + mocked
// Clerk, for UI/UX review. See README.md in this directory.
//
//   node scripts/ui-preview/capture.mjs [--out DIR] [--only a,b] [--viewport mobile|desktop]
//                                       [--base URL] [--dsf N] [--no-server] [--list]
//
// By default it starts the preview Vite server itself (vite.preview.config.ts)
// if nothing is answering on --base, and stops it again at the end.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { routes as defaultRoutes, scenarios, PUBLIC_WHISP_TOKEN, WHISPER_BOX_HANDLE } from "./fixtures.mjs";

const PLAYWRIGHT = process.env.PLAYWRIGHT_MODULE ?? "/opt/node22/lib/node_modules/playwright/index.mjs";
const { chromium } = await import(PLAYWRIGHT);

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, "../..");
const repoRoot = path.resolve(appRoot, "../..");

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
const argv = process.argv.slice(2);
function opt(name, fallback) {
  const i = argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const v = argv[i + 1];
  return v === undefined || v.startsWith("--") ? true : v;
}
const PORT = process.env.UI_PREVIEW_PORT ?? "5199";
const BASE = String(opt("base", `http://127.0.0.1:${PORT}`)).replace(/\/$/, "");
const OUT = path.resolve(String(opt("out", process.env.UI_PREVIEW_OUT ?? "/tmp/ui-preview")));
const ONLY = opt("only", null);
const ONLY_LIST = typeof ONLY === "string" ? ONLY.split(",").map((s) => s.trim()).filter(Boolean) : null;
const VIEWPORT_FILTER = opt("viewport", null);
const DSF = Number(opt("dsf", 1));
const NO_SERVER = argv.includes("--no-server");
const LIST = argv.includes("--list");

const VIEWPORTS = {
  mobile: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36" },
  desktop: { viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false },
};

// ---------------------------------------------------------------------------
// Screens. name → file `<name>-<viewport>.png` (plus `-top` for topShot).
//   signedOut: visit as a visitor (?signedOut=1 flips the Clerk mock)
//   fullPage:  full scroll height (default true)
//   topShot:   ALSO save a viewport-only `<name>-top-<viewport>.png`
//   scenario:  key into fixtures.scenarios (route overrides)
//   viewports: restrict to some viewports
//   action:    async (page, vp) => {} run after load, before the screenshot
//   waitFor:   selector to wait for before settling
//   initScript: function run in the page before any app code (addInitScript)
// ---------------------------------------------------------------------------
function fakeBeforeInstallPrompt() {
  window.addEventListener("load", () => {
    const e = new Event("beforeinstallprompt", { cancelable: true });
    e.prompt = async () => {};
    e.userChoice = Promise.resolve({ outcome: "dismissed" });
    window.dispatchEvent(e);
  });
}

const screens = [
  // ----- signed-out -----
  { name: "landing", path: "/", signedOut: true, topShot: true },
  { name: "how-it-works", path: "/how-it-works", signedOut: true },
  { name: "sign-up", path: "/sign-up", signedOut: true, fullPage: false },
  { name: "recipient", path: `/w/${PUBLIC_WHISP_TOKEN}`, signedOut: true, topShot: true },
  { name: "whisper-box-public", path: `/whisper-box/${WHISPER_BOX_HANDLE}`, signedOut: true },
  { name: "debate-topics-visitor", path: "/debate-topics", signedOut: true },
  { name: "debate-topic-visitor", path: "/debate-topics/dt_1", signedOut: true },

  // ----- signed-in -----
  // /welcome bounces to /dashboard when there's nothing to offer (no install
  // prompt + notifications not askable — both true in headless Chromium), so
  // fake Chrome's beforeinstallprompt to show the install step.
  { name: "welcome", path: "/welcome", initScript: fakeBeforeInstallPrompt },
  { name: "dashboard", path: "/dashboard", topShot: true },
  { name: "send", path: "/send" },
  {
    name: "send-step2",
    path: "/send",
    action: async (page) => {
      // Paste a link and advance — best effort; the step UI may change.
      const input = page.locator('input[type="url"], input[placeholder*="http" i], input[placeholder*="link" i], input[placeholder*="youtube" i]').first();
      if (await input.count()) {
        await input.fill("https://www.youtube.com/watch?v=sunrise01");
        await page.waitForTimeout(1200);
      }
      const next = page.getByRole("button", { name: /^(next|continue)\b/i }).first();
      if (await next.count() && await next.isEnabled().catch(() => false)) {
        await next.click().catch(() => {});
        await page.waitForTimeout(800);
      }
    },
  },
  { name: "whisps-sent", path: "/whisps" },
  {
    name: "whisps-received",
    path: "/whisps",
    action: async (page) => {
      const tab = page.getByRole("tab", { name: /received/i }).or(page.getByRole("button", { name: /received/i })).first();
      if (await tab.count()) { await tab.click().catch(() => {}); await page.waitForTimeout(700); }
    },
  },
  { name: "whisp-detail", path: "/whisps/w_sent_1" },
  { name: "whisp-detail-received", path: "/whisps/w_recv_1" },
  { name: "replies", path: "/replies" },
  { name: "whisper-box-inbox", path: "/whisper-box" },
  { name: "circle", path: "/circle" },
  { name: "debate-topics", path: "/debate-topics" },
  { name: "debate-topic", path: "/debate-topics/dt_1" },
  { name: "settings", path: "/settings" },
  { name: "credits", path: "/credits" },
  {
    name: "more-sheet",
    path: "/dashboard",
    viewports: ["mobile"],
    fullPage: false,
    action: async (page) => {
      await page.locator('[data-testid="button-mobile-more"]').click();
      await page.waitForTimeout(700);
    },
  },
  {
    name: "notifications-open",
    path: "/dashboard",
    fullPage: false,
    action: async (page) => {
      const bell = page.locator('[data-testid="button-notification-bell"]:visible').first();
      if (await bell.count()) { await bell.click().catch(() => {}); await page.waitForTimeout(700); }
    },
  },

  // ----- empty / loading states -----
  { name: "dashboard-empty", path: "/dashboard", scenario: "empty" },
  { name: "whisps-empty", path: "/whisps", scenario: "empty" },
  { name: "whisper-box-inbox-empty", path: "/whisper-box", scenario: "empty" },
  { name: "dashboard-loading", path: "/dashboard", scenario: "loading", fullPage: false, settleMs: 300 },
];

if (LIST) {
  for (const s of screens) console.log(`${s.name.padEnd(28)} ${s.signedOut ? "[visitor] " : "          "}${s.path}${s.scenario ? `  (scenario: ${s.scenario})` : ""}`);
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Local stand-ins for external assets (no network in this harness)
// ---------------------------------------------------------------------------
const fontDirs = {
  inter: path.join(repoRoot, "node_modules/.pnpm/@fontsource+inter@5.3.0/node_modules/@fontsource/inter/files"),
  playfair: path.join(repoRoot, "node_modules/.pnpm/@fontsource+playfair-display@5.3.0/node_modules/@fontsource/playfair-display/files"),
};
function findFontDir(pkg, fallback) {
  if (fs.existsSync(fallback)) return fallback;
  const pnpmDir = path.join(repoRoot, "node_modules/.pnpm");
  const hit = fs.existsSync(pnpmDir) && fs.readdirSync(pnpmDir).find((d) => d.startsWith(`@fontsource+${pkg}@`));
  return hit ? path.join(pnpmDir, hit, `node_modules/@fontsource/${pkg}/files`) : null;
}
const interDir = findFontDir("inter", fontDirs.inter);
const playfairDir = findFontDir("playfair-display", fontDirs.playfair);

function fontCss() {
  const faces = [];
  if (interDir) for (const w of [400, 500, 600, 700]) faces.push(`@font-face{font-family:'Inter';font-style:normal;font-weight:${w};font-display:block;src:url(https://fonts.gstatic.com/uipreview/inter/inter-latin-${w}-normal.woff2) format('woff2');}`);
  if (playfairDir) for (const w of [400, 500, 600, 700]) for (const st of ["normal", "italic"]) faces.push(`@font-face{font-family:'Playfair Display';font-style:${st};font-weight:${w};font-display:block;src:url(https://fonts.gstatic.com/uipreview/playfair/playfair-display-latin-${w}-${st}.woff2) format('woff2');}`);
  return faces.join("\n");
}

// Deterministic gradient "video thumbnail" per id.
function thumbSvg(id, w = 480, h = 360) {
  let hash = 0;
  for (const c of id) hash = (hash * 31 + c.charCodeAt(0)) >>> 0;
  const palettes = [["#7C5CFC", "#F472B6"], ["#0EA5E9", "#6366F1"], ["#F59E0B", "#EF4444"], ["#10B981", "#0EA5E9"], ["#8B5CF6", "#1E1B4B"], ["#EC4899", "#F59E0B"], ["#14B8A6", "#7C3AED"]];
  const [a, b] = palettes[hash % palettes.length];
  const cx = 20 + (hash % 60), cy = 20 + ((hash >> 8) % 60);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient>
<radialGradient id="r" cx="${cx}%" cy="${cy}%" r="60%"><stop offset="0" stop-color="#fff" stop-opacity=".35"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient></defs>
<rect width="100%" height="100%" fill="url(#g)"/><rect width="100%" height="100%" fill="url(#r)"/>
<circle cx="${w * 0.72}" cy="${h * 0.62}" r="${h * 0.32}" fill="#000" fill-opacity=".12"/>
<rect x="0" y="${h * 0.78}" width="100%" height="${h * 0.22}" fill="#000" fill-opacity=".18"/></svg>`;
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------
async function isUp(url) {
  try { const r = await fetch(url, { signal: AbortSignal.timeout(1500) }); return r.ok; } catch { return false; }
}
let serverProc = null;
async function ensureServer() {
  if (await isUp(BASE + "/")) return;
  if (NO_SERVER) throw new Error(`Nothing answering at ${BASE} (and --no-server given)`);
  console.log(`[ui-preview] starting Vite preview server on :${PORT} …`);
  serverProc = spawn(path.join(appRoot, "node_modules/.bin/vite"), ["--config", "scripts/ui-preview/vite.preview.config.ts"], {
    cwd: appRoot,
    env: { ...process.env, UI_PREVIEW_PORT: PORT },
    stdio: ["ignore", "pipe", "pipe"],
  });
  serverProc.stderr.on("data", (d) => process.stderr.write(`[vite] ${d}`));
  for (let i = 0; i < 60; i++) {
    if (await isUp(BASE + "/")) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("Vite preview server did not come up");
}

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------
const unknownApi = new Map(); // "METHOD path" → count
const externalBlocked = new Set();

function matchRoute(table, method, pathname) {
  for (const [m, re, handler] of table) {
    if (m !== "*" && m !== method) continue;
    const params = pathname.match(re);
    if (params) return { handler, params };
  }
  return null;
}

async function installRoutes(context, screen) {
  const state = { signedOut: !!screen.signedOut };
  const tables = [...(screen.scenario ? scenarios[screen.scenario] ?? [] : []), ...defaultRoutes];

  await context.route(/^https?:\/\/[^/]+\/api\//, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const method = req.method();
    let body = null;
    try { body = req.postDataJSON(); } catch { /* not JSON */ }
    const hit = matchRoute(tables, method, url.pathname);
    if (!hit) {
      const key = `${method} ${url.pathname}`;
      unknownApi.set(key, (unknownApi.get(key) ?? 0) + 1);
      // Sensible default: writes succeed, reads return an empty object.
      return route.fulfill({ status: 200, contentType: "application/json", body: method === "GET" ? "{}" : JSON.stringify({ ok: true }) });
    }
    const out = await hit.handler({ url, method, params: hit.params, search: url.searchParams, body, state });
    if (out && out.__hang) return; // never answer → loading state
    if (out && out.__status) {
      return route.fulfill({ status: out.__status, contentType: "application/json", body: out.__body === undefined ? "" : JSON.stringify(out.__body) });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(out ?? {}) });
  });

  // Media thumbnails served by the API itself (uploads).
  await context.route(/\/api\/(public\/w\/[^/]+\/)?media\/.*thumbnail/, (route) =>
    route.fulfill({ status: 200, contentType: "image/svg+xml", body: thumbSvg(route.request().url()) }));

  await context.route(/^https:\/\/fonts\.googleapis\.com\//, (route) =>
    route.fulfill({ status: 200, contentType: "text/css", body: fontCss() }));
  await context.route(/^https:\/\/fonts\.gstatic\.com\/uipreview\//, (route) => {
    const u = new URL(route.request().url());
    const [, , family, file] = u.pathname.split("/");
    const dir = family === "inter" ? interDir : playfairDir;
    const p = dir && path.join(dir, path.basename(file));
    if (!p || !fs.existsSync(p)) return route.fulfill({ status: 404, body: "" });
    return route.fulfill({ status: 200, contentType: "font/woff2", body: fs.readFileSync(p) });
  });
  await context.route(/^https:\/\/i\.ytimg\.com\//, (route) => {
    const id = new URL(route.request().url()).pathname.split("/")[2] ?? "x";
    return route.fulfill({ status: 200, contentType: "image/svg+xml", body: thumbSvg(id) });
  });
  // Everything else off-origin: blocked (no network here) and logged.
  await context.route((url) => !url.href.startsWith(BASE) && !/^(data|blob):/.test(url.protocol) && !/fonts\.(googleapis|gstatic)\.com|i\.ytimg\.com/.test(url.host), (route) => {
    externalBlocked.add(new URL(route.request().url()).host);
    return route.abort();
  });
}

// ---------------------------------------------------------------------------
// Capture
// ---------------------------------------------------------------------------
async function capture(browser, screen, vpName) {
  const vp = VIEWPORTS[vpName];
  const context = await browser.newContext({
    ...vp,
    deviceScaleFactor: DSF,
    colorScheme: "dark",
    locale: "en-US",
    timezoneId: "America/Los_Angeles",
    serviceWorkers: "block",
  });
  await context.addInitScript(() => {
    try {
      // Silence the install prompt (lib/installApp.ts shouldStayQuiet()).
      localStorage.setItem("blindwhisper:installed", String(Date.now()));
      localStorage.setItem("blindwhisper:visitorId", "visitor_preview_0001");
    } catch { /* ignore */ }
  });
  if (screen.initScript) await context.addInitScript(screen.initScript);
  await installRoutes(context, screen);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const t = m.text();
    if (/Failed to load resource|ERR_FAILED|Service Worker/i.test(t)) return;
    errors.push(`console: ${t.slice(0, 300)}`);
  });

  const url = `${BASE}${screen.path}${screen.signedOut ? (screen.path.includes("?") ? "&" : "?") + "signedOut=1" : ""}`;
  await page.goto(url, { waitUntil: "load", timeout: 45000 });
  await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
  if (screen.waitFor) await page.waitForSelector(screen.waitFor, { timeout: 8000 }).catch(() => {});
  await page.evaluate(() => document.fonts?.ready).catch(() => {});
  await page.waitForTimeout(screen.settleMs ?? 1200);
  if (screen.action) {
    await screen.action(page, vpName);
    await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(500);
  }

  fs.mkdirSync(OUT, { recursive: true });
  const files = [];
  if (screen.topShot) {
    const f = path.join(OUT, `${screen.name}-top-${vpName}.png`);
    await page.screenshot({ path: f, fullPage: false });
    files.push(f);
  }
  const f = path.join(OUT, `${screen.name}-${vpName}.png`);
  let useStitched = false;
  if (screen.fullPage ?? true) {
    // Grow the viewport to the document height instead of Playwright's
    // fullPage stitching, so position:fixed chrome (header, bottom nav, the
    // recipient page's docked composer) lands at the real top/bottom of the
    // image rather than floating mid-page at the old viewport edge.
    // AppLayout scrolls an inner container (not the document), so also
    // account for the largest overflowing scrollable element.
    const measure = () => page.evaluate(() => {
      const doc = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight) - window.innerHeight;
      let inner = 0;
      for (const el of document.querySelectorAll("body *")) {
        const oy = getComputedStyle(el).overflowY;
        if ((oy === "auto" || oy === "scroll") && el.clientHeight > 200) inner = Math.max(inner, el.scrollHeight - el.clientHeight);
      }
      return Math.max(doc, inner, 0);
    });
    const extra = await measure();
    if (extra >= 2) {
      await page.setViewportSize({ width: vp.viewport.width, height: Math.min(vp.viewport.height + extra, 12000) });
      await page.waitForTimeout(500);
      // Content sized in vh/dvh grows with the viewport (e.g. a 100dvh hero),
      // so it never "fits" — fall back to Playwright's stitched fullPage.
      if ((await measure()) >= 2) {
        await page.setViewportSize(vp.viewport);
        await page.waitForTimeout(400);
        useStitched = true;
      }
    }
  }
  await page.screenshot({ path: f, fullPage: useStitched });
  files.push(f);
  const finalPath = new URL(page.url()).pathname;
  await context.close();
  return { files, errors, finalPath };
}

await ensureServer();
const browser = await chromium.launch();
const selected = screens.filter((s) => !ONLY_LIST || ONLY_LIST.some((o) => (o.endsWith("*") ? s.name.startsWith(o.slice(0, -1)) : s.name === o)));
if (!selected.length) console.warn(`[ui-preview] --only ${ONLY} matched no screens (see --list)`);
let failures = 0;
try {
  for (const screen of selected) {
    for (const vpName of screen.viewports ?? Object.keys(VIEWPORTS)) {
      if (VIEWPORT_FILTER && VIEWPORT_FILTER !== vpName) continue;
      try {
        const { files, errors, finalPath } = await capture(browser, screen, vpName);
        const redirected = finalPath !== screen.path.split("?")[0] ? `  (ended at ${finalPath})` : "";
        console.log(`✓ ${screen.name}-${vpName}${redirected}  → ${files.map((x) => path.basename(x)).join(", ")}`);
        for (const e of errors) console.log(`    ! ${e}`);
      } catch (e) {
        failures++;
        console.log(`✗ ${screen.name}-${vpName}: ${e.message}`);
      }
    }
  }
} finally {
  await browser.close();
  if (serverProc) serverProc.kill();
}

if (unknownApi.size) {
  console.log("\n[ui-preview] /api calls with NO fixture (answered with {} / {ok:true}) — add them to fixtures.mjs:");
  for (const [k, n] of [...unknownApi].sort()) console.log(`    ${k}  ×${n}`);
}
if (externalBlocked.size) console.log(`\n[ui-preview] blocked external hosts: ${[...externalBlocked].join(", ")}`);
console.log(`\n[ui-preview] screenshots in ${OUT}`);
process.exit(failures ? 1 : 0);
