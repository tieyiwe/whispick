import { Router } from "express";
import { db, debateTopicsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { getPublicAppUrl } from "../lib/publicUrl";
import { escapeHtml } from "../lib/escapeHtml";
import { notRetracted, topicUrl } from "./debateTopics";

const router = Router();

// Same crawler-sniffing pattern as routes/link.ts — kept as its own small
// copy rather than importing that file's constant, since the two are meant
// to stay independently editable (a future whisp-specific UA tweak
// shouldn't silently also change what debate topics unfurl as, or vice
// versa).
const CRAWLER_UA_PATTERN =
  /facebookexternalhit|Facebot|WhatsApp|Twitterbot|Slackbot|TelegramBot|Discordbot|LinkedInBot|SkypeUriPreview|Applebot|Googlebot|redditbot|vkShare|W3C_Validator|Iframely|Embedly|Mastodon|Bluesky|Viber|Line-Bot|SignalBot|Snapchat|Pinterest|bingbot|DuckDuckBot|Google-InspectionTool/i;

/**
 * The URL actually meant to be copied/shared for a debate topic — used by
 * both the "whisp this topic to a contact" flow (routes/debateTopicWhisps.ts)
 * and the frontend's own Share button (DebateTopicCard.tsx/DebateTopicDetail.tsx,
 * which build this same shape client-side from window.location.origin).
 * Deliberately NOT the same as topicUrl()'s bare in-app path: that one is
 * for React Router navigation and in-app notification click-throughs, this
 * one is for anything that leaves the app and might get unfurled by a
 * crawler that can't run the SPA's JS at all.
 */
export function debateTopicShareUrl(appUrl: string, topicId: string): string {
  return `${appUrl}/dt/${topicId}`;
}

// GET /dt/:id (mounted at /api/dt, see routes/index.ts) — see routes/link.ts's
// own comment for the full "why": in production the frontend is static
// files serving the same index.html for every route, so it can never give a
// crawler that doesn't run JS a preview reflecting THIS topic's actual text.
// A real browser gets redirected straight into the SPA; a crawler gets a
// small server-rendered page with real Open Graph tags instead.
router.get("/:id", async (req, res): Promise<void> => {
  const topic = await db
    .select()
    .from(debateTopicsTable)
    .where(eq(debateTopicsTable.id, req.params.id))
    .then((r) => r[0]);

  const appUrl = getPublicAppUrl(req);
  const destination = `${appUrl}${topicUrl(req.params.id)}`;

  const userAgent = req.headers["user-agent"] ?? "";
  const isCrawler = CRAWLER_UA_PATTERN.test(userAgent);

  // A retracted/removed topic must not keep unfurling its text to
  // crawlers — treat it like any unknown id and just bounce to the SPA
  // (which shows its own not-found state).
  const isLive = topic && !topic.deletedByAuthorAt && !topic.removedByAdminAt;
  if (!isLive || !isCrawler) {
    res.redirect(302, destination);
    return;
  }

  const title = escapeHtml(topic!.topicText);
  // The one place this exact line lives — not lib/copy.ts's HOOK_LINE,
  // since that's written for a whisp's "someone sent you a video" framing.
  // This is the one moment a stranger who has never heard of Blind Whisper
  // sees this topic before clicking anything, so the description does the
  // job an og:description is for: say what it is and why tapping through
  // costs nothing, right there in the unfurled card itself.
  const description = escapeHtml("Join the debate — share your opinion. No account needed.");
  const image = escapeHtml(`${appUrl}/opengraph.jpg`);
  const url = escapeHtml(destination);

  res.set("Content-Type", "text/html; charset=utf-8").send(`<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>${title}</title>
    <meta property="og:title" content="${title}" />
    <meta property="og:description" content="${description}" />
    <meta property="og:image" content="${image}" />
    <meta property="og:url" content="${url}" />
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="Blind Whisper" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${title}" />
    <meta name="twitter:description" content="${description}" />
    <meta name="twitter:image" content="${image}" />
    <meta http-equiv="refresh" content="0;url=${url}" />
  </head>
  <body>
    <p>${description}</p>
    <p><a href="${url}">Open it</a></p>
  </body>
</html>`);
});

export default router;
