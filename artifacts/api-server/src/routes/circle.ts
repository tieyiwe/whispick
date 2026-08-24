import { Router } from "express";
import { db } from "@workspace/db";
import { whispsTable } from "@workspace/db";
import { eq, and, desc, lt, isNull } from "drizzle-orm";

const router = Router();

export const CIRCLE_FEED_COLUMNS = {
  id: whispsTable.id,
  videoUrl: whispsTable.videoUrl,
  videoTitle: whispsTable.videoTitle,
  videoThumbnail: whispsTable.videoThumbnail,
  videoPlatform: whispsTable.videoPlatform,
  anonymousNote: whispsTable.anonymousNote,
  senderAlias: whispsTable.senderAlias,
  moodTag: whispsTable.moodTag,
  publicToken: whispsTable.publicToken,
  createdAt: whispsTable.createdAt,
} as const;

export const PAGE_SIZE = 20;

// GET /api/public/circle — public community discovery feed (no auth, no
// recipient data). Only the public feed (circleId IS NULL) and only whisps
// actually due (status = 'delivered' — excludes scheduled-but-not-yet-due
// drops, which would otherwise be visible before their scheduledAt).
router.get("/circle", async (req, res): Promise<void> => {
  const cursor = typeof req.query.cursor === "string" ? req.query.cursor : undefined;
  let cursorDate: Date | undefined;
  if (cursor) {
    const parsed = new Date(cursor);
    if (!Number.isNaN(parsed.getTime())) cursorDate = parsed;
  }

  const baseCondition = and(
    eq(whispsTable.deliveryMethod, "circle_drop"),
    isNull(whispsTable.circleId),
    eq(whispsTable.status, "delivered"),
    isNull(whispsTable.removedByAdminAt),
  );

  const whisps = await db
    .select(CIRCLE_FEED_COLUMNS)
    .from(whispsTable)
    .where(cursorDate ? and(baseCondition, lt(whispsTable.createdAt, cursorDate)) : baseCondition)
    .orderBy(desc(whispsTable.createdAt))
    .limit(PAGE_SIZE);

  const nextCursor = whisps.length === PAGE_SIZE ? whisps[whisps.length - 1]!.createdAt.toISOString() : null;

  res.json({ items: whisps, nextCursor });
});

export default router;
