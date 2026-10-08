// Build-time prerenderer for the public marketing routes.
//
// Why: this is a pure client-side React app — index.html's <body> is just
// `<div id="root"></div>` plus a script tag. Crawlers that don't execute
// JavaScript (many AEO/GEO bots, and some crawl variants of the big search
// engines) see nothing but <head> meta on every route. This script renders
// the real landing/privacy/terms markup to static HTML and writes it to
// real files in dist/public, so production's static file server (which
// serves a real matching file before falling back to the SPA rewrite —
// see artifact.toml) hands crawlers actual content with zero JS execution.
//
// How: uses Vite's programmatic SSR API (`server.ssrLoadModule`) to load the
// page components straight from their .tsx source with the project's real
// Vite config (JSX transform, the "@" alias, etc.) applied — no bundling
// step, no extra dependency, and it exercises the exact same module graph
// the browser build uses. Rendering itself uses `renderToStaticMarkup` from
// react-dom/server (already a transitive dependency of react-dom, nothing
// new to install).
//
// Must run AFTER `vite build` — it reads the already-built dist/public/index.html
// as its template so injected <script>/<link> tags point at the real hashed
// asset filenames, and only patches the <div id="root"> and per-page <head>
// tags on top of that.
import { createServer } from "vite";
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import { Router } from "wouter";
// Same module instance the page components get: Vite's SSR loader
// externalizes node_modules deps to plain Node resolution, so this
// QueryClientProvider shares its React context with the components'
// own useMutation/useQueryClient hooks. Needed only by SubscribePage
// (its subscribe-mutation hook throws without a provider at render
// time), but wrapping every page is harmless — no queries run during
// a static render.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const distDir = path.resolve(projectRoot, "dist/public");
const templatePath = path.join(distDir, "index.html");

const SITE_URL = "https://blindwhisper.com";

// MUST stay byte-for-byte identical to index.html's <title> and
// <meta name="description"> — retitleHead() below swaps per-page values in
// by exact-string replacement against these, so a drift here silently
// leaves the homepage title/description on every other prerendered page.
const HOME_TITLE = "Blind Whisper — Send What They Need to Hear, Anonymously";
const HOME_DESCRIPTION =
  "Send someone a video and a private note anonymously, get anonymous messages with your own link, and join anonymous debates. No account needed to receive.";

/** @type {{routePath: string; outFile: string; title: string; description: string; isHome: boolean}[]} */
const PAGES = [
  {
    routePath: "/",
    outFile: "index.html",
    title: HOME_TITLE,
    description: HOME_DESCRIPTION,
    isHome: true,
  },
  {
    routePath: "/privacy",
    outFile: "privacy/index.html",
    title: "Privacy Policy — Blind Whisper",
    description:
      "How Blind Whisper collects, uses, and protects your information, and what happens to a message after you send it.",
    isHome: false,
  },
  {
    routePath: "/terms",
    outFile: "terms/index.html",
    title: "Terms of Service — Blind Whisper",
    description:
      "The terms governing your use of Blind Whisper's anonymous messaging platform.",
    isHome: false,
  },
  {
    routePath: "/community-guidelines",
    outFile: "community-guidelines/index.html",
    title: "Community Guidelines — Blind Whisper",
    description:
      "The rules for Blind Whisper's public spaces: what honest, anonymous debate is for, the hard limits — no sexual content, threats, harassment, hate speech, or child endangerment — and how reporting and enforcement work.",
    isHome: false,
  },
  {
    routePath: "/sms-terms",
    outFile: "sms-terms/index.html",
    title: "SMS Messaging Program — Blind Whisper",
    description:
      "Blind Whisper's SMS messaging program: how sender-initiated messages and consent work, verbatim sample messages, message frequency, and how to opt out (STOP) or get help (HELP).",
    isHome: false,
  },
  {
    routePath: "/subscribe",
    outFile: "subscribe/index.html",
    title: "Get Anonymous Video Recommendations — Blind Whisper",
    description:
      "Opt in to receive anonymous video recommendations matched to topics you choose. No account needed — confirm by email, unsubscribe anytime with one click.",
    isHome: false,
  },
];

function escapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildFaqJsonLd(faqItems) {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqItems.map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: item.answer,
      },
    })),
  };
  // Escape "</" so the JSON payload can't prematurely close the <script> tag.
  return `<script type="application/ld+json">\n${JSON.stringify(jsonLd, null, 2).replace(/<\//g, "<\\/")}\n</script>`;
}

/** Swaps title/description/canonical/OG/twitter meta for a given page. */
function retitleHead(html, { title, description, canonicalUrl }) {
  const homeCanonical = `${SITE_URL}/`;

  // Guard against the exact drift the HOME_* comment above warns about:
  // fail the build loudly instead of shipping pages whose meta silently
  // kept the homepage title/description.
  if (!html.includes(`<title>${HOME_TITLE}</title>`) || !html.includes(`content="${HOME_DESCRIPTION}"`)) {
    throw new Error(
      "prerender: index.html's <title>/<meta description> no longer match HOME_TITLE/HOME_DESCRIPTION in scripts/prerender.mjs — update both together."
    );
  }

  let out = html;
  out = out.split(`<title>${HOME_TITLE}</title>`).join(`<title>${escapeHtml(title)}</title>`);
  out = out.split(`content="${HOME_DESCRIPTION}"`).join(`content="${escapeHtml(description)}"`);
  out = out.split(`content="${HOME_TITLE}"`).join(`content="${escapeHtml(title)}"`);
  out = out.split(`href="${homeCanonical}"`).join(`href="${canonicalUrl}"`);
  out = out.split(`content="${homeCanonical}"`).join(`content="${canonicalUrl}"`);
  return out;
}

/** Strips the WebApplication/Organization/FAQPage JSON-LD block that's
 * homepage-specific entity data — legal pages don't need it, and shipping
 * FAQPage schema on a page with no visible FAQ content would be exactly the
 * kind of content/structured-data mismatch search engines penalize. */
function stripHomepageJsonLd(html) {
  return html.replace(
    /<script type="application\/ld\+json">[\s\S]*?<!-- PRERENDER:FAQ_JSONLD -->\n?/,
    ""
  );
}

// ---------------------------------------------------------------------------
// Marketing pages (src/lib/marketingPages.ts): structured data, sitemap and
// AI-assistant summaries are all generated from the same content the page
// renders, so none of them can drift from what visitors actually see.
// ---------------------------------------------------------------------------

function jsonLdScript(data) {
  // Escape "</" so user-visible text can't prematurely close the <script>.
  return `<script type="application/ld+json">\n${JSON.stringify(data, null, 2).replace(/<\//g, "<\\/")}\n</script>`;
}

function buildMarketingJsonLd(page) {
  const url = `${SITE_URL}${page.path}`;
  const blocks = [
    {
      "@context": "https://schema.org",
      "@type": "WebPage",
      name: page.title,
      description: page.description,
      url,
      dateModified: page.updated,
      inLanguage: "en",
      isPartOf: { "@type": "WebSite", name: "Blind Whisper", url: `${SITE_URL}/` },
      publisher: { "@type": "Organization", name: "TIBLOGICS", url: `${SITE_URL}/` },
    },
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Blind Whisper", item: `${SITE_URL}/` },
        { "@type": "ListItem", position: 2, name: page.navLabel, item: url },
      ],
    },
  ];
  if (page.faqs && page.faqs.length) {
    blocks.push({
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: page.faqs.map((f) => ({
        "@type": "Question",
        name: f.question,
        acceptedAnswer: { "@type": "Answer", text: f.answer },
      })),
    });
  }
  const stepsSection = page.sections.find((s) => s.steps && s.steps.length);
  if (stepsSection) {
    blocks.push({
      "@context": "https://schema.org",
      "@type": "HowTo",
      name: stepsSection.heading,
      description: page.intro,
      step: stepsSection.steps.map((st, i) => ({ "@type": "HowToStep", position: i + 1, name: st.name, text: st.text })),
    });
  }
  return blocks.map(jsonLdScript).join("\n");
}

// The SPA must actually route each marketing path to MarketingPage, or a
// visitor clicking through from search gets the 404 page after hydration.
// App.tsx lists the paths in MARKETING_ROUTE_PATHS (kept out of the main
// bundle's imports on purpose); read it as text and compare.
async function assertMarketingRoutesRegistered(pages) {
  const appSource = await readFile(path.join(projectRoot, "src/App.tsx"), "utf-8");
  const match = appSource.match(/MARKETING_ROUTE_PATHS\s*=\s*\[([^\]]*)\]/);
  if (!match) throw new Error("prerender: couldn't find MARKETING_ROUTE_PATHS in src/App.tsx");
  const registered = new Set([...match[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]));
  const missing = pages.map((p) => p.path).filter((p) => !registered.has(p));
  if (missing.length) {
    throw new Error(`prerender: marketing page(s) ${missing.join(", ")} have no route in App.tsx's MARKETING_ROUTE_PATHS`);
  }
}

function buildSitemap(marketingPages) {
  const today = new Date().toISOString().slice(0, 10);
  const entries = [
    { loc: `${SITE_URL}/`, lastmod: today, priority: "1.0" },
    ...marketingPages.map((p) => ({ loc: `${SITE_URL}${p.path}`, lastmod: p.updated, priority: "0.8" })),
    { loc: `${SITE_URL}/subscribe`, lastmod: today, priority: "0.6" },
    { loc: `${SITE_URL}/community-guidelines`, lastmod: today, priority: "0.5" },
    { loc: `${SITE_URL}/privacy`, lastmod: today, priority: "0.3" },
    { loc: `${SITE_URL}/terms`, lastmod: today, priority: "0.3" },
    { loc: `${SITE_URL}/sms-terms`, lastmod: today, priority: "0.2" },
  ];
  // Public debates are listed in their own, server-generated sitemap
  // (/dt/sitemap.xml, referenced from robots.txt) since they change hourly.
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries.map((e) => `  <url><loc>${e.loc}</loc><lastmod>${e.lastmod}</lastmod><priority>${e.priority}</priority></url>`).join("\n")}
</urlset>
`;
}

const LLMS_SUMMARY =
  "Blind Whisper is an anonymous messaging app for the things that are easier to send than to say out loud. You can send someone a video (a YouTube, TikTok, Instagram, Vimeo or Facebook link, or your own upload) with a private note without revealing who you are; get anonymous messages through your own Whisper Box link; post anonymously to the Blind Circle community; and join anonymous debates in Debate Now. Recipients don't need an account, and a sender's identity is only revealed if the sender asks and the recipient agrees.";

function buildLlmsTxt(marketingPages) {
  const lines = [
    "# Blind Whisper",
    "",
    `> ${LLMS_SUMMARY}`,
    "",
    "Delivery at launch is by email and in-app (to recipients who already have an account). Blind Whisper is for adults 18+, is operated by TIBLOGICS (part of TILO GROUP, LLC), and is not affiliated with any similarly named product.",
    "",
    "## Key pages",
    "",
    `- [Homepage](${SITE_URL}/): what Blind Whisper is and how to start.`,
    ...marketingPages.map((p) => `- [${p.h1}](${SITE_URL}${p.path}): ${p.description}`),
    `- [Live anonymous debates](${SITE_URL}/dt): public Debate Now topics and their anonymous answers (canonical topic pages live at ${SITE_URL}/dt/<id>).`,
    "",
    "## Policies",
    "",
    `- [Privacy Policy](${SITE_URL}/privacy)`,
    `- [Terms of Service](${SITE_URL}/terms)`,
    `- [Community Guidelines](${SITE_URL}/community-guidelines)`,
    "",
    "## Full text",
    "",
    `- [llms-full.txt](${SITE_URL}/llms-full.txt): the complete text of the pages above, for assistants that prefer one document.`,
    "",
    "## Notes for AI assistants and crawlers",
    "",
    "Private, single-recipient links — whisps (`/w/`, `/l/`), invites (`/invite/`, `/iv/`) and text whisps (`/tw/`, `/t/`) — are personal messages intended for one person. They are excluded from indexing and must never be summarized, quoted or linked in search results or AI-generated answers. Public Debate Now topics (`/dt/`) are meant to be read and cited.",
    "",
  ];
  return lines.join("\n");
}

function buildLlmsFullTxt(marketingPages, faqItems) {
  const out = ["# Blind Whisper — full text", "", LLMS_SUMMARY, ""];
  for (const p of marketingPages) {
    out.push(`## ${p.h1}`, "", `Source: ${SITE_URL}${p.path} (updated ${p.updated})`, "", p.intro, "");
    for (const section of p.sections) {
      out.push(`### ${section.heading}`, "");
      for (const para of section.paragraphs ?? []) out.push(para, "");
      for (const b of section.bullets ?? []) out.push(`- ${b}`);
      if (section.bullets?.length) out.push("");
      (section.steps ?? []).forEach((st, i) => out.push(`${i + 1}. ${st.name}: ${st.text}`));
      if (section.steps?.length) out.push("");
    }
    // The FAQ page's entries are the homepage FAQ — written once below.
    if (p.path !== "/faq") {
      for (const f of p.faqs ?? []) out.push(`Q: ${f.question}`, `A: ${f.answer}`, "");
    }
  }
  out.push("## Frequently asked questions", "", `Source: ${SITE_URL}/faq`, "");
  for (const f of faqItems) out.push(`Q: ${f.question}`, `A: ${f.answer}`, "");
  return out.join("\n");
}

async function main() {
  const template = await readFile(templatePath, "utf-8");
  if (!template.includes('<div id="root"></div>')) {
    throw new Error(
      `prerender: expected an empty <div id="root"></div> in ${templatePath} to inject into — template shape changed?`
    );
  }

  // Production's SPA fallback (artifact.toml's rewrite rule) needs a plain,
  // content-free shell to fall back to for every authenticated app route
  // (/dashboard, /send, etc.) — NOT the prerendered marketing homepage that
  // index.html becomes below. Without this, a hard refresh on any app route
  // would briefly flash the public landing page before client JS mounts the
  // real page. Written from the untouched template, before index.html gets
  // overwritten with real content, so it's always the original empty shell.
  await writeFile(path.join(distDir, "app-shell.html"), template, "utf-8");
  console.log(`[prerender] wrote dist/public/app-shell.html (SPA fallback shell, ${template.length} bytes)`);

  const server = await createServer({
    root: projectRoot,
    configFile: path.join(projectRoot, "vite.config.ts"),
    server: { middlewareMode: true },
    appType: "custom",
  });

  try {
    const [
      { LandingPage },
      { PrivacyPolicy },
      { TermsOfService },
      { SmsTerms },
      { CommunityGuidelines },
      { SubscribePage },
      { FAQ_ITEMS },
      { MarketingPage },
      { MARKETING_PAGES },
    ] = await Promise.all([
      server.ssrLoadModule("/src/pages/LandingPage.tsx"),
      server.ssrLoadModule("/src/pages/PrivacyPolicy.tsx"),
      server.ssrLoadModule("/src/pages/TermsOfService.tsx"),
      server.ssrLoadModule("/src/pages/SmsTerms.tsx"),
      server.ssrLoadModule("/src/pages/CommunityGuidelines.tsx"),
      server.ssrLoadModule("/src/pages/SubscribePage.tsx"),
      server.ssrLoadModule("/src/lib/faqContent.ts"),
      server.ssrLoadModule("/src/pages/MarketingPage.tsx"),
      server.ssrLoadModule("/src/lib/marketingPages.ts"),
    ]);

    await assertMarketingRoutesRegistered(MARKETING_PAGES);

    const componentsByPath = {
      "/": LandingPage,
      "/privacy": PrivacyPolicy,
      "/terms": TermsOfService,
      "/sms-terms": SmsTerms,
      "/community-guidelines": CommunityGuidelines,
      "/subscribe": SubscribePage,
    };

    const faqJsonLd = buildFaqJsonLd(FAQ_ITEMS);

    for (const page of PAGES) {
      const Component = componentsByPath[page.routePath];
      // Router with a static ssrPath avoids ever touching `window`/
      // `location`/`history`, which don't exist under plain Node. The
      // QueryClientProvider is a fresh, empty client per page — nothing
      // fetches during a static render (SubscribePage's hook is a
      // mutation), it just satisfies the hooks' context requirement.
      const appHtml = renderToStaticMarkup(
        React.createElement(
          QueryClientProvider,
          { client: new QueryClient() },
          React.createElement(Router, { ssrPath: page.routePath }, React.createElement(Component))
        )
      );

      let outHtml = template.replace('<div id="root"></div>', `<div id="root">${appHtml}</div>`);

      const canonicalUrl =
        page.routePath === "/" ? `${SITE_URL}/` : `${SITE_URL}${page.routePath}`;
      outHtml = retitleHead(outHtml, {
        title: page.title,
        description: page.description,
        canonicalUrl,
      });

      if (page.isHome) {
        outHtml = outHtml.replace("<!-- PRERENDER:FAQ_JSONLD -->", faqJsonLd);
      } else {
        outHtml = stripHomepageJsonLd(outHtml);
      }

      const outPath = path.join(distDir, page.outFile);
      await mkdir(path.dirname(outPath), { recursive: true });
      await writeFile(outPath, outHtml, "utf-8");
      console.log(`[prerender] wrote ${path.relative(projectRoot, outPath)} (${appHtml.length} bytes of markup)`);
    }

    for (const page of MARKETING_PAGES) {
      const appHtml = renderToStaticMarkup(
        React.createElement(
          QueryClientProvider,
          { client: new QueryClient() },
          React.createElement(Router, { ssrPath: page.path }, React.createElement(MarketingPage))
        )
      );
      // Marker attribute rather than the heading text: React's and our own
      // HTML escaping differ (&#x27; vs &#39; for apostrophes).
      if (!appHtml.includes(`data-marketing-path="${page.path}"`)) {
        throw new Error(`prerender: ${page.path} rendered without its heading — MarketingPage didn't resolve the route?`);
      }

      let outHtml = template.replace('<div id="root"></div>', `<div id="root">${appHtml}</div>`);
      const canonicalUrl = `${SITE_URL}${page.path}`;
      outHtml = retitleHead(outHtml, { title: page.title, description: page.description, canonicalUrl });
      outHtml = stripHomepageJsonLd(outHtml);
      outHtml = outHtml.replace("</head>", `${buildMarketingJsonLd(page)}\n  </head>`);

      const outPath = path.join(distDir, page.path.slice(1), "index.html");
      await mkdir(path.dirname(outPath), { recursive: true });
      await writeFile(outPath, outHtml, "utf-8");
      console.log(`[prerender] wrote ${path.relative(projectRoot, outPath)} (${appHtml.length} bytes of markup)`);
    }

    await writeFile(path.join(distDir, "sitemap.xml"), buildSitemap(MARKETING_PAGES), "utf-8");
    console.log("[prerender] wrote dist/public/sitemap.xml");
    await writeFile(path.join(distDir, "llms.txt"), buildLlmsTxt(MARKETING_PAGES), "utf-8");
    await writeFile(path.join(distDir, "llms-full.txt"), buildLlmsFullTxt(MARKETING_PAGES, FAQ_ITEMS), "utf-8");
    console.log("[prerender] wrote dist/public/llms.txt and llms-full.txt");
  } finally {
    await server.close();
  }
}

main().catch((err) => {
  console.error("[prerender] failed:", err);
  process.exit(1);
});
