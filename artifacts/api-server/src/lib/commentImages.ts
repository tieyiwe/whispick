import multer from "multer";
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

const upload = multer({ storage: fieldLimitedMemoryStorage({ image: MAX_COMMENT_IMAGE_BYTES }), limits: { files: 1 } });

// Deliberately untyped params (req/res/next: any) — matches lib/auth.ts's
// requireAuth reasoning: an explicit Request/Response annotation here would
// force every route this middleware runs on to widen its inferred `:id`
// -style params to the generic ParamsDictionary|ParamsArray union for the
// whole handler chain (surfacing as `string | string[]` at every
// req.params.<x> use in that handler).
export function commentImageUpload(req: any, res: any, next: any) {
  upload.single("image")(req, res, (err: unknown) => {
    if (!err) {
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
export async function storeCommentImage(file: Express.Multer.File): Promise<string | null> {
  if (!ALLOWED_COMMENT_IMAGE_MIME_TYPES.includes(file.mimetype as (typeof ALLOWED_COMMENT_IMAGE_MIME_TYPES)[number])) return null;
  if (!looksLikeDeclaredImageFormat(file.buffer, file.mimetype)) return null;
  const ext = EXTENSION_BY_MIME[file.mimetype];
  const key = `comment-images/${randomUUID()}.${ext}`;
  const ok = await uploadObject(key, file.buffer);
  return ok ? key : null;
}
