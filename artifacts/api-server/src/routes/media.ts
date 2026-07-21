import { Router } from "express";
import { getAuth } from "@clerk/express";
import multer from "multer";
import { db, uploadedVideosTable, whispsTable } from "@workspace/db";
import { eq, and, ne, count, desc } from "drizzle-orm";
import { randomUUID } from "crypto";
import { requireAuth } from "../lib/auth";
import { ensureUser } from "../lib/ensureUser";
import { uploadObject, downloadObject, deleteObject } from "../lib/objectStorage";
import { uploadLimiter } from "../lib/rateLimit";
import {
  ALLOWED_UPLOAD_VIDEO_MIME_TYPES,
  MAX_UPLOAD_DURATION_SECONDS,
  MAX_UPLOAD_THUMBNAIL_BYTES,
  MAX_UPLOAD_VIDEO_BYTES,
  computeUploadExpiresAt,
} from "../lib/uploads";

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  // multer applies one fileSize limit across every field in the request;
  // the thumbnail (much smaller) is checked by hand below.
  limits: { fileSize: MAX_UPLOAD_VIDEO_BYTES, files: 2 },
});

const EXTENSION_BY_MIME: Record<string, string> = {
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
};

async function requireOwnedMedia(id: string, ownerId: string) {
  return db
    .select()
    .from(uploadedVideosTable)
    .where(and(eq(uploadedVideosTable.id, id), eq(uploadedVideosTable.ownerId, ownerId)))
    .then((r) => r[0]);
}

function streamGuardStatus(media: { status: string } | undefined): number | null {
  if (!media) return 404;
  if (media.status !== "ready") return 410;
  return null;
}

// POST /api/media/upload — a sender uploads a clip from their device. Kept
// short (see lib/uploads.ts) so it loads fast for the recipient and doesn't
// chew through storage; no server-side transcoding happens here (there's no
// way to run ffmpeg in every environment this runs in), so the file is
// stored close to as-is and the thumbnail is captured client-side (a
// hidden <video>/<canvas> frame grab) and uploaded alongside it.
router.post(
  "/upload",
  requireAuth,
  uploadLimiter,
  upload.fields([{ name: "video", maxCount: 1 }, { name: "thumbnail", maxCount: 1 }]),
  async (req, res): Promise<void> => {
    const { userId } = getAuth(req);
    const user = await ensureUser(userId!, req);

    const files = req.files as Record<string, Express.Multer.File[]> | undefined;
    const video = files?.video?.[0];
    const thumbnail = files?.thumbnail?.[0];

    if (!video) {
      res.status(400).json({ error: "A video file is required" });
      return;
    }

    if (!ALLOWED_UPLOAD_VIDEO_MIME_TYPES.includes(video.mimetype as (typeof ALLOWED_UPLOAD_VIDEO_MIME_TYPES)[number])) {
      res.status(400).json({ error: "Unsupported video format. Please upload MP4, WebM, or MOV." });
      return;
    }

    if (thumbnail && thumbnail.size > MAX_UPLOAD_THUMBNAIL_BYTES) {
      res.status(400).json({ error: "Thumbnail is too large" });
      return;
    }

    const durationSeconds = Number(req.body?.durationSeconds);
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
      res.status(400).json({ error: "Missing or invalid video duration" });
      return;
    }
    if (durationSeconds > MAX_UPLOAD_DURATION_SECONDS) {
      res.status(400).json({
        error: `Please keep uploads under ${Math.floor(MAX_UPLOAD_DURATION_SECONDS / 60)} minutes so they load fast for the recipient.`,
        code: "video_too_long",
      });
      return;
    }

    const id = randomUUID();
    const ext = EXTENSION_BY_MIME[video.mimetype] ?? "mp4";
    const objectKey = `uploads/${user.id}/${id}/video.${ext}`;
    const thumbnailObjectKey = thumbnail ? `uploads/${user.id}/${id}/thumb.jpg` : null;

    const videoUploaded = await uploadObject(objectKey, video.buffer);
    if (!videoUploaded) {
      res.status(503).json({ error: "Video storage is temporarily unavailable. Try again shortly." });
      return;
    }

    if (thumbnailObjectKey && thumbnail) {
      // Best-effort — a missing thumbnail just means no poster image later.
      await uploadObject(thumbnailObjectKey, thumbnail.buffer);
    }

    await db.insert(uploadedVideosTable).values({
      id,
      ownerId: user.id,
      originalFilename: video.originalname || "video",
      objectKey,
      thumbnailObjectKey,
      mimeType: video.mimetype,
      sizeBytes: video.size,
      durationSeconds: Math.round(durationSeconds),
      status: "ready",
      expiresAt: computeUploadExpiresAt(),
    });

    const created = await db.select().from(uploadedVideosTable).where(eq(uploadedVideosTable.id, id)).then((r) => r[0]);
    res.status(201).json({ ...created, usageCount: 0 });
  },
);

// GET /api/media — the sender's Media Library
router.get("/", requireAuth, async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  const user = await ensureUser(userId!, req);

  const rows = await db
    .select({
      media: uploadedVideosTable,
      usageCount: count(whispsTable.id),
    })
    .from(uploadedVideosTable)
    .leftJoin(whispsTable, eq(whispsTable.uploadedVideoId, uploadedVideosTable.id))
    .where(and(eq(uploadedVideosTable.ownerId, user.id), ne(uploadedVideosTable.status, "deleted")))
    .groupBy(uploadedVideosTable.id)
    .orderBy(desc(uploadedVideosTable.createdAt));

  res.json(rows.map((r) => ({ ...r.media, usageCount: r.usageCount })));
});

// DELETE /api/media/:id — owner removes it before retention would anyway;
// the row stays (status flips to 'deleted') so any whisp that already used
// it keeps a resolvable, if now-410ing, reference.
router.delete("/:id", requireAuth, async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  const user = await ensureUser(userId!, req);

  const media = await requireOwnedMedia(req.params.id as string, user.id);
  if (!media) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  await deleteObject(media.objectKey);
  if (media.thumbnailObjectKey) await deleteObject(media.thumbnailObjectKey);

  await db
    .update(uploadedVideosTable)
    .set({ status: "deleted", deletedAt: new Date() })
    .where(eq(uploadedVideosTable.id, media.id));

  res.json({ ok: true });
});

// GET /api/media/:id/file — owner-only stream, used for the Media Library's
// own preview/reuse picker (the recipient-facing stream is
// /public/w/:token/media instead, scoped by token possession).
router.get("/:id/file", requireAuth, async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  const user = await ensureUser(userId!, req);

  const media = await requireOwnedMedia(req.params.id as string, user.id);
  const guardStatus = streamGuardStatus(media);
  if (guardStatus) {
    res.status(guardStatus).json({ error: guardStatus === 404 ? "Not found" : "This video is no longer available" });
    return;
  }

  const bytes = await downloadObject(media!.objectKey);
  if (!bytes) {
    res.status(503).json({ error: "Video storage is temporarily unavailable" });
    return;
  }

  res.setHeader("Content-Type", media!.mimeType);
  res.setHeader("Content-Length", String(bytes.length));
  res.send(bytes);
});

// GET /api/media/:id/thumbnail — owner-only
router.get("/:id/thumbnail", requireAuth, async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  const user = await ensureUser(userId!, req);

  const media = await requireOwnedMedia(req.params.id as string, user.id);
  const guardStatus = streamGuardStatus(media);
  if (guardStatus || !media!.thumbnailObjectKey) {
    res.status(guardStatus ?? 404).json({ error: "Not found" });
    return;
  }

  const bytes = await downloadObject(media!.thumbnailObjectKey);
  if (!bytes) {
    res.status(503).json({ error: "Thumbnail storage is temporarily unavailable" });
    return;
  }

  res.setHeader("Content-Type", "image/jpeg");
  res.setHeader("Content-Length", String(bytes.length));
  res.send(bytes);
});

export default router;
