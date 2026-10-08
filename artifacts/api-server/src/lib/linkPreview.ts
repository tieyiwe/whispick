import type { Response } from "express";
import { escapeHtml } from "./escapeHtml";

// Server-rendered link previews. The frontend is static files in production
// (one index.html for every route), so it can never show a link-preview bot
// per-link Open Graph tags; every shareable link therefore points at a route
// on this server that answers a bot with a small OG page and a person with a
// 302 into the SPA (routes/link.ts, whisperBoxLink.ts, debateTopicLink.ts,
// inviteLink.ts, textWhispLink.ts). The card images come from routes/og.ts.

// User-triggered link-preview fetchers — the bots that build the card a
// person sees after pasting a link into a chat or post. Notes on the
// non-obvious ones:
// - iMessage fetches as "... facebookexternalhit/1.1 Facebot Twitterbot/1.0";
//   Instagram/Threads/Messenger as facebookexternalhit; LINE as
//   "facebookexternalhit ... line-poker".
// - Signal fetches on-device with a "WhatsApp" User-Agent on purpose.
// - Google Messages (RCS) is "GoogleMessages"; Bluesky's card service is
//   "Cardyb"; Teams/Skype are "SkypeUriPreview", newer Outlook/Teams
//   "MicrosoftPreview"; Slack is "Slackbot-LinkExpanding" + "Slack-ImgProxy".
// - The search engines at the end were already in the original whisp-link
//   list: on a private link they get the noindex preview page, which is
//   exactly what should tell them to drop it.
// Deliberately NO AI crawlers or AI-assistant fetchers here: private links
// (whisps, invites, Text Whisps) only need to unfurl for people.
const LINK_PREVIEW_BOTS = [
  "facebookexternalhit",
  "Facebot",
  "Twitterbot",
  "WhatsApp",
  "TelegramBot",
  "Discordbot",
  "Slackbot",
  "Slack-ImgProxy",
  "SignalBot",
  "Snapchat",
  "Snap URL Preview",
  "LinkedInBot",
  "redditbot",
  "Bluesky",
  "Cardyb",
  "Mastodon",
  "Pleroma",
  "Akkoma",
  "Misskey",
  "GoogleMessages",
  "SkypeUriPreview",
  "MicrosoftPreview",
  "Viber",
  "Line-Bot",
  "line-poker",
  "kakaotalk-scrap",
  "Pinterest",
  "Tumblr",
  "vkShare",
  "Iframely",
  "Embedly",
  "W3C_Validator",
  "Applebot",
  "Googlebot",
  "Google-InspectionTool",
  "bingbot",
  "DuckDuckBot",
];

// Search-engine and AI crawlers/fetchers on top of the above. Only PUBLIC,
// indexable pages (debate topics) answer these with content: most don't run
// the SPA's JavaScript and would otherwise see an empty shell.
const SEARCH_AND_AI_CRAWLERS = [
  "GoogleOther",
  "Storebot-Google",
  "BingPreview",
  "msnbot",
  "DuckAssistBot",
  "YandexBot",
  "Baiduspider",
  "GPTBot",
  "OAI-SearchBot",
  "ChatGPT-User",
  "ClaudeBot",
  "Claude-User",
  "Claude-SearchBot",
  "Claude-Web",
  "anthropic-ai",
  "PerplexityBot",
  "Perplexity-User",
  "Amazonbot",
  "Meta-ExternalAgent",
  "Meta-ExternalFetcher",
  "MistralAI-User",
  "CCBot",
  "cohere-ai",
  "YouBot",
  "Bytespider",
  "Applebot-Extended",
];

const toPattern = (names: string[]) => new RegExp(names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "i");

export const LINK_PREVIEW_UA_PATTERN = toPattern(LINK_PREVIEW_BOTS);
export const PUBLIC_CRAWLER_UA_PATTERN = toPattern([...LINK_PREVIEW_BOTS, ...SEARCH_AND_AI_CRAWLERS]);

export function isLinkPreviewBot(userAgent: string | undefined): boolean {
  return LINK_PREVIEW_UA_PATTERN.test(userAgent ?? "");
}

export function isPublicCrawler(userAgent: string | undefined): boolean {
  return PUBLIC_CRAWLER_UA_PATTERN.test(userAgent ?? "");
}

export type OgImageKind = "default" | "whisp" | "textwhisp" | "invite" | "circle" | "whisperbox" | "debate";

/** Absolute URL of a generated card (routes/og.ts) — crawlers require absolute og:image URLs. */
export function ogImageUrl(appUrl: string, kind: OgImageKind, id?: string): string {
  return `${appUrl}/api/og/${kind}${id ? `/${encodeURIComponent(id)}` : ""}.png`;
}

/**
 * The link an invite is sent as (routes/invites.ts). Served by this server
 * at the bare /iv prefix (app.ts + artifact.toml) so a pasted invite can
 * unfurl a real preview — the SPA's /invite/:token can't, being static. A
 * browser is 302'd straight on to /invite/:token, which keeps working for
 * every invite already sent in the old form.
 */
export function inviteShareUrl(appUrl: string, token: string): string {
  return `${appUrl}/iv/${encodeURIComponent(token)}`;
}

/**
 * The link a guest Text Whisp is texted as (routes/textWhisps.ts,
 * lib/textWhispScheduler.ts) — bare /tx prefix, 302 on to the SPA's
 * /tw/:token, same arrangement as inviteShareUrl. Not "/t": if the
 * platform's path router matches by string prefix, "/t" would also capture
 * /terms, /tw and /text-whisps.
 */
export function textWhispShareUrl(appUrl: string, token: string): string {
  return `${appUrl}/tx/${encodeURIComponent(token)}`;
}

export type PreviewPage = {
  title: string;
  description: string;
  /** The shared (preview) URL itself — og:url. Never the SPA URL: Facebook
   *  re-scrapes og:url, and the SPA would hand it the generic site tags. */
  shareUrl: string;
  /** Where a person (or a bot that follows meta refresh) ends up. */
  destination: string;
  image: string;
  imageAlt: string;
  /** Private links (anything holding a capability token) must never be indexed. */
  private: boolean;
  type?: string;
};

export function renderPreviewPage(p: PreviewPage): string {
  const title = escapeHtml(p.title);
  const description = escapeHtml(p.description);
  const shareUrl = escapeHtml(p.shareUrl);
  const destination = escapeHtml(p.destination);
  const image = escapeHtml(p.image);
  const imageAlt = escapeHtml(p.imageAlt);
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title}</title>
    <meta name="description" content="${description}" />
    ${p.private ? '<meta name="robots" content="noindex, nofollow" />' : ""}
    <meta property="og:title" content="${title}" />
    <meta property="og:description" content="${description}" />
    <meta property="og:image" content="${image}" />
    <meta property="og:image:type" content="image/png" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta property="og:image:alt" content="${imageAlt}" />
    <meta property="og:url" content="${shareUrl}" />
    <meta property="og:type" content="${escapeHtml(p.type ?? "website")}" />
    <meta property="og:site_name" content="Blind Whisper" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${title}" />
    <meta name="twitter:description" content="${description}" />
    <meta name="twitter:image" content="${image}" />
    <meta name="twitter:image:alt" content="${imageAlt}" />
    <meta http-equiv="refresh" content="0;url=${destination}" />
  </head>
  <body>
    <p>${description}</p>
    <p><a href="${destination}">Open it</a></p>
  </body>
</html>`;
}

export function sendPreviewPage(res: Response, page: PreviewPage): void {
  res.set("Content-Type", "text/html; charset=utf-8");
  if (page.private) {
    // Header form of the noindex too (honored even by crawlers that skip
    // parsing <meta>), and no shared caching of a page whose URL is a
    // capability token.
    res.set("X-Robots-Tag", "noindex, nofollow").set("Cache-Control", "no-store");
  }
  res.send(renderPreviewPage(page));
}
