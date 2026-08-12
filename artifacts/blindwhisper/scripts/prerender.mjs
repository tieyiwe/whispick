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
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const distDir = path.resolve(projectRoot, "dist/public");
const templatePath = path.join(distDir, "index.html");

const SITE_URL = "https://blindwhisper.com";

/** @type {{routePath: string; outFile: string; title: string; description: string; isHome: boolean}[]} */
const PAGES = [
  {
    routePath: "/",
    outFile: "index.html",
    title: "Blind Whisper — Send What They Need to Hear, Anonymously",
    description:
      "Blind Whisper lets you send a video to someone who needs it, anonymously. Whisper Links, Ghost Boost matching, and Circle — no account required to receive.",
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
  const homeTitle = "Blind Whisper — Send What They Need to Hear, Anonymously";
  const homeDescription =
    "Blind Whisper lets you send a video to someone who needs it, anonymously. Whisper Links, Ghost Boost matching, and Circle — no account required to receive.";
  const homeCanonical = `${SITE_URL}/`;

  let out = html;
  out = out.split(`<title>${homeTitle}</title>`).join(`<title>${escapeHtml(title)}</title>`);
  out = out.split(`content="${homeDescription}"`).join(`content="${escapeHtml(description)}"`);
  out = out.split(`content="${homeTitle}"`).join(`content="${escapeHtml(title)}"`);
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

  const server = await createServer({
    root: projectRoot,
    configFile: path.join(projectRoot, "vite.config.ts"),
    server: { middlewareMode: true },
    appType: "custom",
  });

  try {
    const [{ LandingPage }, { PrivacyPolicy }, { TermsOfService }, { FAQ_ITEMS }] = await Promise.all([
      server.ssrLoadModule("/src/pages/LandingPage.tsx"),
      server.ssrLoadModule("/src/pages/PrivacyPolicy.tsx"),
      server.ssrLoadModule("/src/pages/TermsOfService.tsx"),
      server.ssrLoadModule("/src/lib/faqContent.ts"),
    ]);

    const componentsByPath = {
      "/": LandingPage,
      "/privacy": PrivacyPolicy,
      "/terms": TermsOfService,
    };

    const faqJsonLd = buildFaqJsonLd(FAQ_ITEMS);

    for (const page of PAGES) {
      const Component = componentsByPath[page.routePath];
      // These three components only consume wouter's Router context (for
      // <Link>) — no TanStack Query, no Clerk — so a bare Router with a
      // static ssrPath is enough. ssrPath avoids ever touching `window`/
      // `location`/`history`, which don't exist under plain Node.
      const appHtml = renderToStaticMarkup(
        React.createElement(Router, { ssrPath: page.routePath }, React.createElement(Component))
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
