import { Router } from "express";
import { db } from "@workspace/db";
import { whispsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { getPublicAppUrl } from "../lib/publicUrl";
import { HOOK_LINE } from "../lib/copy";
import { escapeHtml } from "../lib/escapeHtml";

const router = Router();

// Known link-unfurling crawlers used by messaging/social apps. Real browsers
// don't match these, so they fall through to the redirect below.
const CRAWLER_UA_PATTERN =
  /facebookexternalhit|Facebot|WhatsApp|Twitterbot|Slackbot|TelegramBot|Discordbot|LinkedInBot|SkypeUriPreview|Applebot|Googlebot|redditbot|vkShare|W3C_Validator|Iframely|Embedly|Mastodon|Bluesky|Viber|Line-Bot|SignalBot|Snapchat|Pinterest|bingbot|DuckDuckBot|Google-InspectionTool/i;

// GET /l/:token — the URL actually shared via email/SMS/WhatsApp. Crawlers
// get a small server-rendered page with real Open Graph tags for that
// specific video (the SPA can't do this: in production the frontend is
// served as static files with the same index.html for every route, so it
// can never reflect per-whisp content to a crawler that doesn't run JS).
// Everyone else gets redirected straight into the real app.
router.get("/:token", async (req, res): Promise<void> => {
  const whisp = await db
    .select()
    .from(whispsTable)
    .where(eq(whispsTable.publicToken, req.params.token))
    .then((r) => r[0]);

  const appUrl = getPublicAppUrl(req);
  const destination = `${appUrl}/w/${req.params.token}`;

  const userAgent = req.headers["user-agent"] ?? "";
  const isCrawler = CRAWLER_UA_PATTERN.test(userAgent);

  if (!whisp || !isCrawler) {
    res.redirect(302, destination);
    return;
  }

  const title = whisp.videoTitle ? escapeHtml(whisp.videoTitle) : "Blind Whisper";
  const description = escapeHtml(HOOK_LINE);
  // Crawlers require an ABSOLUTE og:image. An uploaded video's thumbnail is
  // stored as a site-relative path (routes/whisps.ts stores
  // /api/public/w/:token/media/thumbnail, since no absolute host is known at
  // write time), so passing it through unchanged meant every whisp made from
  // an upload unfurled with no image at all.
  const rawImage = whisp.videoThumbnail
    ? whisp.videoThumbnail.startsWith("/")
      ? `${appUrl}${whisp.videoThumbnail}`
      : whisp.videoThumbnail
    : `${appUrl}/opengraph.jpg`;
  const image = escapeHtml(rawImage);
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
    <meta property="og:type" content="video.other" />
    <meta property="og:site_name" content="Blind Whisper" />
    <meta property="og:image:alt" content="Video thumbnail" />
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
