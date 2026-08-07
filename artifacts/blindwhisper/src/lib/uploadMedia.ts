// Mirrors artifacts/api-server/src/lib/uploads.ts — keep both in sync if the
// caps ever change. The server re-enforces these; this is purely so a
// sender finds out their clip is too long/large before spending time on an
// upload that would just get rejected.
export const MAX_UPLOAD_DURATION_SECONDS = 120;
export const MAX_UPLOAD_VIDEO_BYTES = 30 * 1024 * 1024;
export const ALLOWED_UPLOAD_VIDEO_MIME_TYPES = ["video/mp4", "video/webm", "video/quicktime"];

export interface UploadedVideoResult {
  id: string;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  durationSeconds: number | null;
  status: string;
  expiresAt: string;
  createdAt: string;
  usageCount: number;
}

export class UploadValidationError extends Error {}

// Reads a video file's duration and grabs a single frame as a JPEG
// thumbnail entirely client-side (a hidden <video>/<canvas> pair) — there's
// no ffmpeg (or any other video-processing binary) available server-side in
// every environment this runs in, and this is essentially free since the
// browser already has to decode the video to play it.
function captureVideoMetadata(file: File): Promise<{ durationSeconds: number; thumbnail: Blob | null }> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    video.preload = "metadata";
    video.muted = true;
    video.playsInline = true;
    const objectUrl = URL.createObjectURL(file);
    video.src = objectUrl;

    const cleanup = () => URL.revokeObjectURL(objectUrl);

    video.onloadedmetadata = () => {
      const durationSeconds = video.duration;
      if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
        cleanup();
        reject(new UploadValidationError("Couldn't read this video's length"));
        return;
      }
      if (durationSeconds > MAX_UPLOAD_DURATION_SECONDS) {
        cleanup();
        reject(
          new UploadValidationError(
            `Please keep uploads under ${Math.floor(MAX_UPLOAD_DURATION_SECONDS / 60)} minutes so they load fast for the recipient.`,
          ),
        );
        return;
      }
      video.currentTime = Math.min(1, durationSeconds / 2);
    };

    video.onseeked = () => {
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth || 640;
      canvas.height = video.videoHeight || 360;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        cleanup();
        resolve({ durationSeconds: video.duration, thumbnail: null });
        return;
      }
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(
        (blob) => {
          cleanup();
          resolve({ durationSeconds: video.duration, thumbnail: blob });
        },
        "image/jpeg",
        0.8,
      );
    };

    video.onerror = () => {
      cleanup();
      reject(new UploadValidationError("Couldn't read this video file"));
    };
  });
}

export async function uploadMedia(file: File): Promise<UploadedVideoResult> {
  if (!ALLOWED_UPLOAD_VIDEO_MIME_TYPES.includes(file.type)) {
    throw new UploadValidationError("Please upload an MP4, WebM, or MOV video.");
  }
  if (file.size > MAX_UPLOAD_VIDEO_BYTES) {
    throw new UploadValidationError(`Please keep uploads under ${Math.round(MAX_UPLOAD_VIDEO_BYTES / (1024 * 1024))}MB.`);
  }

  const { durationSeconds, thumbnail } = await captureVideoMetadata(file);

  const formData = new FormData();
  formData.append("video", file, file.name);
  formData.append("durationSeconds", String(durationSeconds));
  if (thumbnail) formData.append("thumbnail", thumbnail, "thumbnail.jpg");

  const res = await fetch("/api/media/upload", { method: "POST", body: formData });
  const data = await res.json().catch(() => null);

  if (!res.ok) {
    throw new Error(data?.error ?? `Upload failed (${res.status})`);
  }

  return data as UploadedVideoResult;
}
