import { Router } from "express";
import { getPublicAppUrl } from "../lib/publicUrl";
import { LINK_PREVIEW_COPY } from "../lib/copy";
import { isLinkPreviewBot, ogImageUrl, sendPreviewPage } from "../lib/linkPreview";
import { MOOD_GLOW } from "../lib/ogImage";
import { loadLiveWhisp } from "./public";

const router = Router();

// GET /l/:token — the URL actually shared via email/SMS/WhatsApp. Link-
// preview bots get a small server-rendered page with Open Graph tags (the
// SPA can't do this: in production the frontend is served as static files
// with the same index.html for every route, so it can never reflect a
// per-link preview to a crawler that doesn't run JS). Everyone else gets
// redirected straight into the real app.
//
// The card is pure curiosity — never the video's title or thumbnail, the
// note, or anything about the sender: a whisp link gets pasted into group
// chats and forwarded, and a preview that spoils or hints at the content
// leaks it to everyone who sees the link, not just the recipient.
router.get("/:token", async (req, res): Promise<void> => {
  const appUrl = getPublicAppUrl(req);
  const token = encodeURIComponent(req.params.token);
  const destination = `${appUrl}/w/${token}`;

  if (!isLinkPreviewBot(req.headers["user-agent"])) {
    res.redirect(302, destination);
    return;
  }

  // Same liveness rules as the public whisp page itself (taken down,
  // scheduled, cancelled, or a DM cloned from a removed Circle post):
  // anything the recipient couldn't open must not unfurl either — just
  // bounce to the SPA, which shows its own not-found state.
  const whisp = await loadLiveWhisp(req.params.token);
  if (!whisp) {
    res.redirect(302, destination);
    return;
  }

  const isCirclePost = whisp.deliveryMethod === "circle_drop";
  const copy = isCirclePost ? LINK_PREVIEW_COPY.circlePost : LINK_PREVIEW_COPY.whisp;
  // The image URL carries only the mood (it tints the card's glow), never
  // the token: og:image URLs end up in crawler and CDN caches, and the card
  // is the same for every whisp with that mood anyway.
  const mood = whisp.moodTag && MOOD_GLOW[whisp.moodTag] ? whisp.moodTag : "none";
  const image = isCirclePost ? ogImageUrl(appUrl, "circle") : ogImageUrl(appUrl, "whisp", mood);

  sendPreviewPage(res, {
    title: copy.title,
    description: copy.description,
    shareUrl: `${appUrl}/api/l/${token}`,
    destination,
    image,
    imageAlt: copy.imageAlt,
    private: true,
  });
});

export default router;
