import { Router } from "express";
import { getPublicAppUrl } from "../lib/publicUrl";
import { WHISPER_BOX_HOOK_LINE } from "../lib/copy";
import { escapeHtml } from "../lib/escapeHtml";
import { resolveWhisperBoxOwner } from "./whisperBox";

const router = Router();

// Same UA list link.ts uses — see that file's comment for why a real
// browser never matches this.
const CRAWLER_UA_PATTERN =
  /facebookexternalhit|Facebot|WhatsApp|Twitterbot|Slackbot|TelegramBot|Discordbot|LinkedInBot|SkypeUriPreview|Applebot|Googlebot|redditbot|vkShare|W3C_Validator|Iframely|Embedly|Mastodon|Bluesky|Viber|Line-Bot|SignalBot|Snapchat|Pinterest|bingbot|DuckDuckBot|Google-InspectionTool/i;

// GET /wb/:handle — the URL actually meant to be shared for a Whisper Box
// (Settings' Share/Copy/Share-to-Story, WhisperBoxLinkDialog, the Story
// card's embedded link and QR) — same reasoning as link.ts's GET /l/:token:
// the SPA is served as static files with one index.html for every route in
// production, so it can never show a crawler a real per-account preview.
// Crawlers get a small server-rendered page with Open Graph tags; everyone
// else gets redirected straight into the real /whisper-box/:handle page.
router.get("/:handle", async (req, res): Promise<void> => {
  const owner = await resolveWhisperBoxOwner(req.params.handle);
  const appUrl = getPublicAppUrl(req);
  const destination = `${appUrl}/whisper-box/${encodeURIComponent(req.params.handle)}`;

  const userAgent = req.headers["user-agent"] ?? "";
  const isCrawler = CRAWLER_UA_PATTERN.test(userAgent);

  // An unknown handle, or a disabled box, must not unfurl a preview that
  // implies there's someone to message — same anti-enumeration posture as
  // GET /public/whisper-box/:handle's identical-404 behavior. Just bounce
  // to the SPA, which shows its own not-found state either way.
  if (!owner?.whisperBoxEnabled || !isCrawler) {
    res.redirect(302, destination);
    return;
  }

  const title = escapeHtml(`Whisper Box — @${req.params.handle}`);
  const description = escapeHtml(WHISPER_BOX_HOOK_LINE);
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
