import multer from "multer";
import sharp from "sharp";
import { randomUUID } from "crypto";
import { fieldLimitedMemoryStorage } from "./fieldLimitedStorage";
import { uploadObject } from "./objectStorage";

export const MAX_COMMENT_IMAGE_BYTES = 5 * 1024 * 1024;
export const ALLOWED_COMMENT_IMAGE_MIME_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;

const EXTENSION_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

// Same posture as lib/uploads.ts's looksLikeDeclaredVideoFormat — a quick
// magic-byte sanity check so a declared mimetype can't be used to park
// arbitrary bytes behind an image key, not a full format validator.
export function looksLikeDeclaredImageFormat(buffer: Buffer, mimeType: string): boolean {
  if (buffer.length < 4) return false;
  if (mimeType === "image/jpeg") return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (mimeType === "image/png") return buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47;
  if (mimeType === "image/gif") return buffer.subarray(0, 3).toString("ascii") === "GIF";
  if (mimeType === "image/webp") return buffer.length >= 12 && buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP";
  return false;
}

// Bounds decode memory: a 5MB PNG can still declare a gigapixel canvas.
// Comfortably above a real photo that fits under the 5MB cap (phones
// default to 12-50MP).
const MAX_INPUT_PIXELS = 100_000_000;

/**
 * Decodes and re-encodes an image in its own format, which drops every
 * EXIF/XMP/IPTC/ICC block — GPS coordinates, camera make/model/serial,
 * capture time — since sharp only writes metadata when withMetadata() is
 * asked for (it deliberately isn't). rotate() bakes the EXIF orientation
 * into the pixels first so stripping it doesn't leave the photo sideways.
 * animated: true keeps every frame of a GIF/animated WebP.
 *
 * Returns null if the bytes can't be decoded — callers must treat that as a
 * rejection, never fall back to storing the original.
 */
export async function reencodeImage(buffer: Buffer, mimeType: string): Promise<Buffer | null> {
  try {
    const pipeline = sharp(buffer, { animated: true, limitInputPixels: MAX_INPUT_PIXELS }).rotate();
    if (mimeType === "image/jpeg") return await pipeline.jpeg({ quality: 90 }).toBuffer();
    if (mimeType === "image/png") return await pipeline.png().toBuffer();
    if (mimeType === "image/webp") return await pipeline.webp({ quality: 90 }).toBuffer();
    if (mimeType === "image/gif") return await pipeline.gif().toBuffer();
    return null;
  } catch {
    return null;
  }
}

// Files already validated and re-encoded by commentImageUpload, so
// storeCommentImage doesn't decode them a second time.
const sanitizedFiles = new WeakSet<Express.Multer.File>();

const upload = multer({ storage: fieldLimitedMemoryStorage({ image: MAX_COMMENT_IMAGE_BYTES }), limits: { files: 1 } });

// Deliberately untyped params (req/res/next: any) — matches lib/auth.ts's
// requireAuth reasoning: an explicit Request/Response annotation here would
// force every route this middleware runs on to widen its inferred `:id`
// -style params to the generic ParamsDictionary|ParamsArray union for the
// whole handler chain (surfacing as `string | string[]` at every
// req.params.<x> use in that handler).
//
// Also validates and strips the image's metadata here, in the middleware
// rather than in storeCommentImage, so EVERY route using it (Circle and
// Debate comments) rejects an unusable image with a 400 instead of silently
// posting the comment without it — or worse, storing it with GPS intact.
export function commentImageUpload(req: any, res: any, next: any) {
  upload.single("image")(req, res, async (err: unknown) => {
    if (!err) {
      const file: Express.Multer.File | undefined = req.file;
      if (!file) {
        next();
        return;
      }
      if (
        !ALLOWED_COMMENT_IMAGE_MIME_TYPES.includes(file.mimetype as (typeof ALLOWED_COMMENT_IMAGE_MIME_TYPES)[number]) ||
        !looksLikeDeclaredImageFormat(file.buffer, file.mimetype)
      ) {
        res.status(400).json({ error: "Images must be JPEG, PNG, WebP, or GIF." });
        return;
      }
      const clean = await reencodeImage(file.buffer, file.mimetype);
      if (!clean) {
        res.status(400).json({ error: "We couldn't process that image. Try a different one." });
        return;
      }
      file.buffer = clean;
      file.size = clean.length;
      sanitizedFiles.add(file);
      next();
      return;
    }
    const message = err instanceof Error ? err.message : "Upload failed";
    if (message.startsWith("FIELD_TOO_LARGE:image")) {
      res.status(400).json({ error: "Image is too large (max 5MB)" });
      return;
    }
    res.status(400).json({ error: "Upload failed" });
  });
}

// Uploads a comment's attached image to object storage and returns the key
// to persist on the comment row (imageObjectKey) — called from both
// routes/debateTopics.ts and routes/public.ts's comment-post handlers, kept
// here as one shared helper instead of duplicated per route.
//
// Re-encodes (metadata strip) itself if handed a file that didn't come
// through commentImageUpload, so no path can store original bytes.
export async function storeCommentImage(file: Express.Multer.File): Promise<string | null> {
  if (!ALLOWED_COMMENT_IMAGE_MIME_TYPES.includes(file.mimetype as (typeof ALLOWED_COMMENT_IMAGE_MIME_TYPES)[number])) return null;
  if (!looksLikeDeclaredImageFormat(file.buffer, file.mimetype)) return null;
  const bytes = sanitizedFiles.has(file) ? file.buffer : await reencodeImage(file.buffer, file.mimetype);
  if (!bytes) return null;
  const ext = EXTENSION_BY_MIME[file.mimetype];
  const key = `comment-images/${randomUUID()}.${ext}`;
  const ok = await uploadObject(key, bytes);
  return ok ? key : null;
}
