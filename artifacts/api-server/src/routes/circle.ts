import { Router } from "express";
import { db } from "@workspace/db";
import { whispsTable } from "@workspace/db";
import { eq, and, desc, lt } from "drizzle-orm";

const router = Router();

const PAGE_SIZE = 20;

// GET /api/public/circle — community discovery feed (no auth, no recipient data)
router.get("/circle", async (req, res): Promise<void> => {
  const cursor = typeof req.query.cursor === "string" ? req.query.cursor : undefined;
  let cursorDate: Date | undefined;
  if (cursor) {
    const parsed = new Date(cursor);
    if (!Number.isNaN(parsed.getTime())) cursorDate = parsed;
  }

  const whisps = await db
    .select({
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
    })
    .from(whispsTable)
    .where(
      cursorDate
        ? and(eq(whispsTable.deliveryMethod, "circle_drop"), lt(whispsTable.createdAt, cursorDate))
        : eq(whispsTable.deliveryMethod, "circle_drop"),
    )
    .orderBy(desc(whispsTable.createdAt))
    .limit(PAGE_SIZE);

  const nextCursor = whisps.length === PAGE_SIZE ? whisps[whisps.length - 1]!.createdAt.toISOString() : null;

  res.json({ items: whisps, nextCursor });
});

export default router;
