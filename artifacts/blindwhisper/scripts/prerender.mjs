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
  "Blind Whisper lets you send a video to someone who needs it, anonymously. Whisper Links and Circle — no account required to receive.";

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
    const [{ LandingPage }, { PrivacyPolicy }, { TermsOfService }, { SmsTerms }, { CommunityGuidelines }, { SubscribePage }, { FAQ_ITEMS }] =
      await Promise.all([
        server.ssrLoadModule("/src/pages/LandingPage.tsx"),
        server.ssrLoadModule("/src/pages/PrivacyPolicy.tsx"),
        server.ssrLoadModule("/src/pages/TermsOfService.tsx"),
        server.ssrLoadModule("/src/pages/SmsTerms.tsx"),
        server.ssrLoadModule("/src/pages/CommunityGuidelines.tsx"),
        server.ssrLoadModule("/src/pages/SubscribePage.tsx"),
        server.ssrLoadModule("/src/lib/faqContent.ts"),
      ]);

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
  } finally {
    await server.close();
  }
}

main().catch((err) => {
  console.error("[prerender] failed:", err);
  process.exit(1);
});
