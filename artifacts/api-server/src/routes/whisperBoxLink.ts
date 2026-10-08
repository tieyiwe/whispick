import { Router } from "express";
import { getPublicAppUrl } from "../lib/publicUrl";
import { LINK_PREVIEW_COPY } from "../lib/copy";
import { isLinkPreviewBot, ogImageUrl, sendPreviewPage } from "../lib/linkPreview";
import { resolveWhisperBoxOwner } from "./whisperBox";

const router = Router();

// GET /wb/:handle — the URL actually meant to be shared for a Whisper Box
// (Settings' Share/Copy/Share-to-Story, WhisperBoxLinkDialog, the Story
// card's embedded link and QR) — same reasoning as link.ts's GET /l/:token:
// the SPA is served as static files with one index.html for every route in
// production, so it can never show a crawler a real per-account preview.
// Crawlers get a small server-rendered page with Open Graph tags; everyone
// else gets redirected straight into the real /whisper-box/:handle page.
router.get("/:handle", async (req, res): Promise<void> => {
  const handle = req.params.handle;
  const appUrl = getPublicAppUrl(req);
  const destination = `${appUrl}/whisper-box/${encodeURIComponent(handle)}`;

  if (!isLinkPreviewBot(req.headers["user-agent"])) {
    res.redirect(302, destination);
    return;
  }

  // An unknown handle, or a disabled box, must not unfurl a preview that
  // implies there's someone to message — same anti-enumeration posture as
  // GET /public/whisper-box/:handle's identical-404 behavior. Just bounce
  // to the SPA, which shows its own not-found state either way.
  const owner = await resolveWhisperBoxOwner(handle);
  if (!owner?.whisperBoxEnabled) {
    res.redirect(302, destination);
    return;
  }

  const copy = LINK_PREVIEW_COPY.whisperBox;
  sendPreviewPage(res, {
    title: copy.title(handle),
    description: copy.description,
    shareUrl: `${appUrl}/wb/${encodeURIComponent(handle)}`,
    destination,
    image: ogImageUrl(appUrl, "whisperbox", handle),
    imageAlt: copy.imageAlt(handle),
    // Meant to be posted publicly (bios, stories) by its owner — indexable.
    private: false,
  });
});

export default router;
