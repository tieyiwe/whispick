import { getAuthToken, type CircleComment } from "@workspace/api-client-react";

// Mirrors artifacts/api-server/src/lib/commentImages.ts — keep both in sync
// if the caps ever change. The server re-enforces these; this is purely so
// a commenter finds out their image is too big or the wrong type before
// spending time on an upload that would just get rejected.
export const MAX_COMMENT_IMAGE_BYTES = 5 * 1024 * 1024;
export const ALLOWED_COMMENT_IMAGE_MIME_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

export class CommentImageValidationError extends Error {}

export function validateCommentImage(file: File): void {
  if (!ALLOWED_COMMENT_IMAGE_MIME_TYPES.includes(file.type)) {
    throw new CommentImageValidationError("Please attach a JPEG, PNG, WebP, or GIF image.");
  }
  if (file.size > MAX_COMMENT_IMAGE_BYTES) {
    throw new CommentImageValidationError(`Please keep images under ${Math.round(MAX_COMMENT_IMAGE_BYTES / (1024 * 1024))}MB.`);
  }
}

export interface PostCircleCommentWithImageError extends Error {
  data: unknown;
}

// POST /api/public/w/:token/comments with an image attached — a
// hand-written multipart/form-data request rather than a generated
// customFetch call, same reasoning as lib/uploadMedia.ts: a `format:
// binary` body generates File/Blob-typed Zod schemas that don't compile in
// lib/api-zod's Node-only project (see the comment near "POST
// /media/upload" at the top of lib/api-spec/openapi.yaml). Text-only
// comments still go through the generated usePostCircleComment hook.
export async function postCircleCommentWithImage(
  token: string,
  data: { commentText: string; visitorId: string; parentCommentId?: string | null; image: File },
): Promise<CircleComment> {
  validateCommentImage(data.image);

  const formData = new FormData();
  formData.append("commentText", data.commentText);
  formData.append("visitorId", data.visitorId);
  if (data.parentCommentId) formData.append("parentCommentId", data.parentCommentId);
  formData.append("image", data.image, data.image.name);

  // Same reasoning as lib/uploadMedia.ts's own bearer-token attach: a
  // hand-built request skips customFetch's automatic Authorization header,
  // and isPoster detection on this endpoint depends on it for a signed-in
  // poster commenting on their own post.
  const authToken = await getAuthToken();
  const res = await fetch(`/api/public/w/${token}/comments`, {
    method: "POST",
    body: formData,
    headers: authToken ? { authorization: `Bearer ${authToken}` } : undefined,
  });
  const body = await res.json().catch(() => null);

  if (!res.ok) {
    const error = new Error(body?.error ?? `Couldn't post that comment (${res.status})`) as PostCircleCommentWithImageError;
    error.data = body;
    throw error;
  }

  return body as CircleComment;
}
