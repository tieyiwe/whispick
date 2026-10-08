import { Router } from "express";
import { db, textWhispsTable } from "@workspace/db";
import { and, eq, notInArray } from "drizzle-orm";
import { getPublicAppUrl } from "../lib/publicUrl";
import { LINK_PREVIEW_COPY } from "../lib/copy";
import { isLinkPreviewBot, ogImageUrl, sendPreviewPage, textWhispShareUrl } from "../lib/linkPreview";
import { excludeRemoved } from "./textWhisps";

const router = Router();

// GET /tx/:token — see textWhispShareUrl (lib/linkPreview.ts). Deliberately
// reads the row directly rather than calling GET /api/public/text-whisps/
// :token: that endpoint marks the note read, and a link-preview bot fetching
// the page must not.
router.get("/:token", async (req, res): Promise<void> => {
  const appUrl = getPublicAppUrl(req);
  const destination = `${appUrl}/tw/${encodeURIComponent(req.params.token)}`;

  if (!isLinkPreviewBot(req.headers["user-agent"])) {
    res.redirect(302, destination);
    return;
  }

  // Same visibility as the guest page: removed, not-yet-sent (scheduled)
  // and cancelled notes don't unfurl.
  const textWhisp = await db
    .select({ id: textWhispsTable.id })
    .from(textWhispsTable)
    .where(
      and(
        eq(textWhispsTable.publicToken, req.params.token),
        excludeRemoved(),
        notInArray(textWhispsTable.status, ["scheduled", "cancelled"]),
      ),
    )
    .then((r) => r[0]);
  if (!textWhisp) {
    res.redirect(302, destination);
    return;
  }

  const copy = LINK_PREVIEW_COPY.textWhisp;
  sendPreviewPage(res, {
    title: copy.title,
    description: copy.description,
    shareUrl: textWhispShareUrl(appUrl, req.params.token),
    destination,
    image: ogImageUrl(appUrl, "textwhisp"),
    imageAlt: copy.imageAlt,
    private: true,
  });
});

export default router;
