import { Router } from "express";
import { db, invitesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { getPublicAppUrl } from "../lib/publicUrl";
import { LINK_PREVIEW_COPY } from "../lib/copy";
import { inviteShareUrl, isLinkPreviewBot, ogImageUrl, sendPreviewPage } from "../lib/linkPreview";

const router = Router();

// GET /iv/:token — see inviteShareUrl (lib/linkPreview.ts). Never names the
// inviter, even after a reveal: the preview is seen by whoever the link is
// pasted in front of, and the reveal is a consent flow between two people,
// not something to show a group chat.
router.get("/:token", async (req, res): Promise<void> => {
  const appUrl = getPublicAppUrl(req);
  const destination = `${appUrl}/invite/${encodeURIComponent(req.params.token)}`;

  if (!isLinkPreviewBot(req.headers["user-agent"])) {
    res.redirect(302, destination);
    return;
  }

  const invite = await db
    .select({ id: invitesTable.id })
    .from(invitesTable)
    .where(eq(invitesTable.publicToken, req.params.token))
    .then((r) => r[0]);
  if (!invite) {
    res.redirect(302, destination);
    return;
  }

  const copy = LINK_PREVIEW_COPY.invite;
  sendPreviewPage(res, {
    title: copy.title,
    description: copy.description,
    shareUrl: inviteShareUrl(appUrl, req.params.token),
    destination,
    image: ogImageUrl(appUrl, "invite"),
    imageAlt: copy.imageAlt,
    private: true,
  });
});

export default router;
