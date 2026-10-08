import { Router } from "express";
import { db, debateTopicsTable, debateTopicCommentsTable } from "@workspace/db";
import { and, desc, eq, inArray, max, count } from "drizzle-orm";
import { getPublicAppUrl } from "../lib/publicUrl";
import { escapeHtml } from "../lib/escapeHtml";
import { getHandlesFor } from "../lib/anonymousHandles";
import { getOrBackfillWhispererIdentities } from "../lib/whispererHandle";
import { commentNotRemoved, notRetracted, topicUrl } from "./debateTopics";

const router = Router();

// Same crawler-sniffing pattern as routes/link.ts — kept as its own copy so
// the two can be tuned independently. Unlike whisp links (private, never
// indexed), debate topics are public and meant to be found, so this list
// also covers search engines and AI assistants' crawlers/fetchers: most of
// those don't run the SPA's JavaScript and would otherwise see an empty shell.
const CRAWLER_UA_PATTERN =
  /facebookexternalhit|Facebot|WhatsApp|Twitterbot|Slackbot|TelegramBot|Discordbot|LinkedInBot|SkypeUriPreview|Applebot|Googlebot|Google-InspectionTool|GoogleOther|Storebot-Google|bingbot|BingPreview|msnbot|DuckDuckBot|DuckAssistBot|YandexBot|Baiduspider|redditbot|vkShare|W3C_Validator|Iframely|Embedly|Mastodon|Bluesky|Viber|Line-Bot|SignalBot|Snapchat|Pinterest|GPTBot|OAI-SearchBot|ChatGPT-User|ClaudeBot|Claude-User|Claude-SearchBot|Claude-Web|anthropic-ai|PerplexityBot|Perplexity-User|Amazonbot|Meta-ExternalAgent|Meta-ExternalFetcher|MistralAI-User|CCBot|cohere-ai|YouBot|Bytespider|Applebot-Extended/i;

const SHARE_DESCRIPTION = "Join this debate and answer 100% anonymously — no account needed.";
// Comments rendered into the crawler page. The full thread is in the app;
// this is enough for a search engine or AI assistant to understand what the
// debate is about without making the page unbounded.
const MAX_RENDERED_COMMENTS = 60;
const SITEMAP_LIMIT = 45_000;

/**
 * The URL meant to be copied/shared for a debate topic — used by the
 * "whisp this topic to a contact" flow (routes/debateTopicWhisps.ts) and the
 * frontend's Share buttons. /dt is served by THIS server (bare prefix, see
 * app.ts + artifact.toml) so link previews and crawlers get real per-topic
 * HTML; a browser is redirected straight into the SPA. It's also the
 * canonical, indexable URL for a topic — the SPA route itself is kept out of
 * search (robots.txt) so the two never compete as duplicates.
 */
export function debateTopicShareUrl(appUrl: string, topicId: string): string {
  return `${appUrl}/dt/${topicId}`;
}

function isCrawler(userAgent: string | undefined): boolean {
  return CRAWLER_UA_PATTERN.test(userAgent ?? "");
}

function truncate(text: string, max: number): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`;
}

// JSON-LD lives inside <script>; escapeHtml isn't the right escaping there.
// JSON.stringify plus neutralizing "<" keeps user text from closing the tag.
function jsonLd(data: unknown): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}

function page(opts: {
  title: string;
  description: string;
  canonical: string;
  ogTitle: string;
  image: string;
  robots: string;
  structuredData?: unknown;
  body: string;
}): string {
  const t = escapeHtml(opts.title);
  const d = escapeHtml(opts.description);
  const c = escapeHtml(opts.canonical);
  const ogT = escapeHtml(opts.ogTitle);
  const img = escapeHtml(opts.image);
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${t}</title>
    <meta name="description" content="${d}" />
    <meta name="robots" content="${escapeHtml(opts.robots)}" />
    <link rel="canonical" href="${c}" />
    <meta property="og:title" content="${ogT}" />
    <meta property="og:description" content="${d}" />
    <meta property="og:image" content="${img}" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta property="og:url" content="${c}" />
    <meta property="og:type" content="article" />
    <meta property="og:site_name" content="Blind Whisper" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${ogT}" />
    <meta name="twitter:description" content="${d}" />
    <meta name="twitter:image" content="${img}" />
    ${opts.structuredData ? `<script type="application/ld+json">${jsonLd(opts.structuredData)}</script>` : ""}
  </head>
  <body>
${opts.body}
  </body>
</html>`;
}

// GET /dt/sitemap.xml — every live topic with at least one answer. A topic
// nobody has answered yet is thin content, so it's left out (and its page is
// noindex, below) until the first answer arrives. Declared before /:id so it
// isn't swallowed as a topic id.
router.get("/sitemap.xml", async (req, res): Promise<void> => {
  const appUrl = getPublicAppUrl(req);
  const rows = await db
    .select({
      id: debateTopicsTable.id,
      createdAt: debateTopicsTable.createdAt,
      lastAnswerAt: max(debateTopicCommentsTable.createdAt),
    })
    .from(debateTopicsTable)
    .innerJoin(
      debateTopicCommentsTable,
      and(eq(debateTopicCommentsTable.topicId, debateTopicsTable.id), commentNotRemoved()),
    )
    .where(notRetracted())
    .groupBy(debateTopicsTable.id, debateTopicsTable.createdAt)
    .orderBy(desc(max(debateTopicCommentsTable.createdAt)))
    .limit(SITEMAP_LIMIT);

  const urls = rows
    .map((r) => {
      const lastmod = (r.lastAnswerAt ? new Date(r.lastAnswerAt) : r.createdAt).toISOString();
      return `  <url><loc>${escapeHtml(debateTopicShareUrl(appUrl, r.id))}</loc><lastmod>${lastmod}</lastmod></url>`;
    })
    .join("\n");

  res
    .set("Content-Type", "application/xml; charset=utf-8")
    .set("Cache-Control", "public, max-age=3600")
    .send(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${escapeHtml(`${appUrl}/dt`)}</loc></url>
${urls}
</urlset>`);
});

// GET /dt — hub of recent debates for crawlers (internal links are how a
// search engine discovers topic pages beyond the sitemap); people go to the
// in-app Debate Now feed.
router.get("/", async (req, res): Promise<void> => {
  const appUrl = getPublicAppUrl(req);
  if (!isCrawler(req.headers["user-agent"])) {
    res.redirect(302, `${appUrl}/debate-topics`);
    return;
  }

  const topics = await db
    .select({ id: debateTopicsTable.id, topicText: debateTopicsTable.topicText, createdAt: debateTopicsTable.createdAt })
    .from(debateTopicsTable)
    .where(notRetracted())
    .orderBy(desc(debateTopicsTable.createdAt))
    .limit(100);
  const ids = topics.map((t) => t.id);
  const counts = ids.length
    ? await db
        .select({ topicId: debateTopicCommentsTable.topicId, n: count() })
        .from(debateTopicCommentsTable)
        .where(and(inArray(debateTopicCommentsTable.topicId, ids), commentNotRemoved()))
        .groupBy(debateTopicCommentsTable.topicId)
    : [];
  const countById = Object.fromEntries(counts.map((c) => [c.topicId, Number(c.n)]));

  const description =
    "Debate Now on Blind Whisper: real questions, honest answers, 100% anonymous. Read the debates and add your own answer — no account needed.";
  const list = topics
    .map((t) => {
      const n = countById[t.id] ?? 0;
      return `      <li><a href="${escapeHtml(debateTopicShareUrl(appUrl, t.id))}">${escapeHtml(t.topicText)}</a> — ${n} anonymous ${n === 1 ? "answer" : "answers"}</li>`;
    })
    .join("\n");

  res.set("Content-Type", "text/html; charset=utf-8").send(
    page({
      title: "Anonymous debates — Debate Now | Blind Whisper",
      description,
      canonical: `${appUrl}/dt`,
      ogTitle: "Debate Now — answer 100% anonymously",
      image: `${appUrl}/opengraph.jpg`,
      robots: "index, follow",
      structuredData: {
        "@context": "https://schema.org",
        "@type": "CollectionPage",
        name: "Debate Now — anonymous debates on Blind Whisper",
        description,
        url: `${appUrl}/dt`,
        isPartOf: { "@type": "WebSite", name: "Blind Whisper", url: `${appUrl}/` },
      },
      body: `    <main>
      <h1>Debate Now — answer 100% anonymously</h1>
      <p>${escapeHtml(description)}</p>
      <ul>
${list}
      </ul>
      <p><a href="${escapeHtml(`${appUrl}/debate-topics`)}">Open Debate Now</a></p>
    </main>`,
    }),
  );
});

// GET /dt/:id — a browser is redirected into the SPA. A link-preview bot
// gets real Open Graph tags; a search engine or AI crawler gets the topic and
// its anonymous answers as plain HTML plus DiscussionForumPosting structured
// data (the same content the SPA shows — only rendered server-side).
router.get("/:id", async (req, res): Promise<void> => {
  const appUrl = getPublicAppUrl(req);
  const destination = `${appUrl}${topicUrl(req.params.id)}`;

  if (!isCrawler(req.headers["user-agent"])) {
    res.redirect(302, destination);
    return;
  }

  const topic = await db
    .select()
    .from(debateTopicsTable)
    .where(and(eq(debateTopicsTable.id, req.params.id), notRetracted()))
    .then((r) => r[0]);

  // A retracted/removed or unknown topic must not keep unfurling or stay in
  // a search index: a real 404 tells crawlers to drop it.
  if (!topic) {
    res.status(404).set("Content-Type", "text/html; charset=utf-8").send(
      page({
        title: "Debate not found | Blind Whisper",
        description: "This debate isn't available anymore.",
        canonical: `${appUrl}/dt`,
        ogTitle: "Debate not found",
        image: `${appUrl}/opengraph.jpg`,
        robots: "noindex",
        body: `    <main><h1>This debate isn't available anymore.</h1><p><a href="${escapeHtml(`${appUrl}/dt`)}">See other debates</a></p></main>`,
      }),
    );
    return;
  }

  const comments = await db
    .select({
      id: debateTopicCommentsTable.id,
      commentText: debateTopicCommentsTable.commentText,
      parentCommentId: debateTopicCommentsTable.parentCommentId,
      createdAt: debateTopicCommentsTable.createdAt,
      visitorId: debateTopicCommentsTable.visitorId,
      authorUserId: debateTopicCommentsTable.authorUserId,
    })
    .from(debateTopicCommentsTable)
    .where(and(eq(debateTopicCommentsTable.topicId, topic.id), commentNotRemoved()))
    .orderBy(debateTopicCommentsTable.createdAt);

  // Same public handles the SPA shows (per-thread anonymous handle, or a
  // signed-in commenter's pseudonymous Whisperer handle) — never anything
  // that identifies a person. visitorId/authorUserId are only used to look
  // the handle up and are never rendered.
  const [handles, identities] = await Promise.all([
    getHandlesFor("debate_topic", topic.id, comments.filter((c) => !c.authorUserId).map((c) => c.visitorId)),
    getOrBackfillWhispererIdentities([topic.authorId, ...comments.map((c) => c.authorUserId).filter((id): id is string => !!id)]),
  ]);
  const handleFor = (c: (typeof comments)[number]) =>
    (c.authorUserId ? identities[c.authorUserId]?.handle : handles[c.visitorId]?.handle) ?? "Anonymous";
  const authorHandle = identities[topic.authorId]?.handle ?? "Anonymous";

  const n = comments.length;
  const description = n > 0
    ? `${SHARE_DESCRIPTION} ${n} ${n === 1 ? "person has" : "people have"} answered so far.`
    : SHARE_DESCRIPTION;
  const canonical = debateTopicShareUrl(appUrl, topic.id);
  const rendered = comments.slice(0, MAX_RENDERED_COMMENTS);

  const commentsHtml = rendered
    .map(
      (c) =>
        `        <li${c.parentCommentId ? ' class="reply"' : ""}><article><p><strong>${escapeHtml(handleFor(c))}</strong> · <time datetime="${c.createdAt.toISOString()}">${c.createdAt.toISOString().slice(0, 10)}</time></p><p>${escapeHtml(c.commentText)}</p></article></li>`,
    )
    .join("\n");

  res.set("Content-Type", "text/html; charset=utf-8").send(
    page({
      title: `${truncate(topic.topicText, 70)} — Anonymous debate | Blind Whisper`,
      description,
      canonical,
      ogTitle: topic.topicText,
      image: `${appUrl}/opengraph.jpg`,
      // Unanswered topics are thin content: let crawlers follow links but
      // keep the page out of the index until someone answers.
      robots: n > 0 ? "index, follow, max-image-preview:large" : "noindex, follow",
      structuredData: {
        "@context": "https://schema.org",
        "@type": "DiscussionForumPosting",
        headline: truncate(topic.topicText, 110),
        text: topic.topicText,
        url: canonical,
        datePublished: topic.createdAt.toISOString(),
        author: { "@type": "Person", name: authorHandle },
        interactionStatistic: {
          "@type": "InteractionCounter",
          interactionType: "https://schema.org/CommentAction",
          userInteractionCount: n,
        },
        isPartOf: { "@type": "WebSite", name: "Blind Whisper", url: `${appUrl}/` },
        comment: rendered.map((c) => ({
          "@type": "Comment",
          text: c.commentText,
          datePublished: c.createdAt.toISOString(),
          author: { "@type": "Person", name: handleFor(c) },
        })),
      },
      body: `    <main>
      <article>
        <h1>${escapeHtml(topic.topicText)}</h1>
        <p>Asked anonymously by <strong>${escapeHtml(authorHandle)}</strong> on <time datetime="${topic.createdAt.toISOString()}">${topic.createdAt.toISOString().slice(0, 10)}</time> · ${n} anonymous ${n === 1 ? "answer" : "answers"}</p>
        <p>${escapeHtml(SHARE_DESCRIPTION)}</p>
        <p><a href="${escapeHtml(destination)}">Add your answer anonymously</a></p>
        ${n > 0 ? `<h2>Anonymous answers</h2>\n        <ol>\n${commentsHtml}\n        </ol>` : "<p>No answers yet — be the first.</p>"}
      </article>
      <nav><a href="${escapeHtml(`${appUrl}/dt`)}">More anonymous debates</a> · <a href="${escapeHtml(`${appUrl}/`)}">Blind Whisper</a></nav>
    </main>`,
    }),
  );
});

export default router;
