// End-to-end smoke crawl (see artifacts/api-server/e2e/README.md): loads every
// app route against the REAL API as a signed-in user and as a visitor, at
// desktop and phone sizes, and reports console errors, uncaught page errors
// and any /api response >= 400 (or >= 500 only, with --server-errors-only).
//
//   E2E_WEB_PORT=5400 node scripts/e2e/crawl.mjs [--user e2e_alice] [--routes /a,/b]
// Same Playwright resolution as scripts/ui-preview/capture.mjs.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? "/opt/node22/lib/node_modules/playwright/index.mjs");

const BASE = `http://127.0.0.1:${process.env.E2E_WEB_PORT ?? "5400"}`;
const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const USER = opt("user", "e2e_alice");

const SIGNED_IN_ROUTES = [
  "/dashboard", "/welcome", "/send", "/send-text", "/whisps", "/text-whisps", "/replies",
  "/whisper-box", "/circle", "/circles", "/debate-topics", "/debate-topics/following",
  "/whisper-groups", "/media-library", "/invite", "/credits", "/settings", "/recap", "/onboarding/first-whispers", "/debate-topics/new", "/account/security", "/admin_pro",
];
const PUBLIC_ROUTES = [
  "/", "/how-it-works", "/anonymous-message-link", "/anonymous-debates", "/safety", "/ideas", "/about", "/faq",
  "/privacy", "/terms", "/community-guidelines", "/sms-terms", "/sign-in", "/sign-up", "/debate-topics", "/subscribe", "/unsubscribe", "/w/does-not-exist", "/whisper-box/nobody", "/tw/nope", "/invite/nope", "/dashboard", "/no-such-page",
];
const only = opt("routes", null)?.split(",");

async function visit(browser, { user, route, viewport }) {
  const context = await browser.newContext({ viewport, serviceWorkers: "block" });
  if (user) await context.addCookies([{ name: "e2e_user", value: user, url: BASE }]);
  const page = await context.newPage();
  const problems = [];
  page.on("console", (msg) => {
    // "Failed to load resource" lines duplicate the response/requestfailed
    // entries below (which carry the URL); external hosts (fonts, Clerk) are
    // unreachable from this sandbox and aren't the app's problem.
    if (msg.type() === "error" && !msg.text().startsWith("Failed to load resource")) problems.push(`console: ${msg.text().slice(0, 300)}`);
  });
  page.on("pageerror", (err) => problems.push(`pageerror: ${String(err).slice(0, 300)}`));
  page.on("requestfailed", (req) => {
    const url = new URL(req.url());
    // The heartbeat is still in flight when the context closes — expected.
    if (url.origin === BASE && !url.pathname.endsWith("/visitor-ping")) problems.push(`failed ${req.method()} ${url.pathname}: ${req.failure()?.errorText}`);
  });
  page.on("response", (res) => {
    const url = new URL(res.url());
    if (url.origin === BASE && url.pathname.startsWith("/api/") && res.status() >= 400) {
      problems.push(`api ${res.request().method()} ${url.pathname} -> ${res.status()}`);
    }
  });
  try {
    await page.goto(BASE + route, { waitUntil: "networkidle", timeout: 30_000 });
    await page.waitForTimeout(500);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (overflow > 1) problems.push(`horizontal overflow ${overflow}px`);
  } catch (err) {
    problems.push(`navigation: ${String(err).slice(0, 200)}`);
  }
  await context.close();
  return problems;
}

const browser = await chromium.launch();
const viewports = { desktop: { width: 1280, height: 860 }, phone: { width: 375, height: 780 } };
let total = 0;
for (const [label, user, routes] of [["signed-in", USER, SIGNED_IN_ROUTES], ["visitor", null, PUBLIC_ROUTES]]) {
  for (const route of routes) {
    if (only && !only.includes(route)) continue;
    for (const [vpName, viewport] of Object.entries(viewports)) {
      const problems = await visit(browser, { user, route, viewport });
      // Collapse identical messages across viewports into one line each.
      for (const p of [...new Set(problems)]) {
        total++;
        console.log(`[${label} ${vpName}] ${route}: ${p}`);
      }
    }
  }
}
await browser.close();
console.log(`\n${total} problem(s)`);
