import { getAuthToken } from "@workspace/api-client-react";

// Mirrors artifacts/api-server/src/lib/uploads.ts — keep both in sync if the
// caps ever change. The server re-enforces these; this is purely so a
// sender finds out their clip is too long/large before spending time on an
// upload that would just get rejected.
//
// 60s for now, for every plan — the plan-differentiated cap (e.g. a longer
// limit for paid plans) is a deliberate future change, not done yet; see
// lib/plans.ts if/when that's built.
export const MAX_UPLOAD_DURATION_SECONDS = 60;
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
//
// A file straight out of MediaRecorder (CameraCapture.tsx's in-app record
// flow) is a special case: Chrome/Android in particular writes WebM (and
// sometimes MP4) blobs with no finalized duration in the container header,
// so `video.duration` reads as Infinity/NaN on `loadedmetadata` even though
// the recording is perfectly valid — a well-documented browser quirk, not a
// real "unreadable" file. The fix is to force a seek near the end of the
// file, which makes the browser walk the whole stream and compute the real
// duration; only after THAT still fails do we treat it as genuinely
// unreadable. A plain uploaded file (already has a real duration) never
// takes this slower path at all.
function captureVideoMetadata(file: File): Promise<{ durationSeconds: number; thumbnail: Blob | null }> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    video.preload = "metadata";
    video.muted = true;
    video.playsInline = true;
    const objectUrl = URL.createObjectURL(file);
    video.src = objectUrl;

    const cleanup = () => URL.revokeObjectURL(objectUrl);
    let recoveryAttempted = false;

    function proceedWithDuration(durationSeconds: number) {
      if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
        cleanup();
        reject(new UploadValidationError("Couldn't read this video's length"));
        return;
      }
      if (durationSeconds > MAX_UPLOAD_DURATION_SECONDS) {
        cleanup();
        const minutes = Math.floor(MAX_UPLOAD_DURATION_SECONDS / 60);
        reject(
          new UploadValidationError(
            `Please keep uploads under ${minutes} minute${minutes === 1 ? "" : "s"} so they load fast for the recipient.`,
          ),
        );
        return;
      }
      video.ontimeupdate = null;
      video.onseeked = captureThumbnail;
      video.currentTime = Math.min(1, durationSeconds / 2);
    }

    function captureThumbnail() {
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
    }

    video.onloadedmetadata = () => {
      if (Number.isFinite(video.duration) && video.duration > 0) {
        proceedWithDuration(video.duration);
        return;
      }
      // Force the browser to walk the stream and recompute a real
      // duration. `ontimeupdate` fires once that seek actually lands with
      // an updated `video.duration`; a raw `Infinity` seek target is
      // clamped to the file's real end by every browser that supports it.
      recoveryAttempted = true;
      video.ontimeupdate = () => {
        video.ontimeupdate = null;
        proceedWithDuration(video.duration);
      };
      video.currentTime = 1e10;
    };

    video.onseeked = captureThumbnail;

    video.onerror = () => {
      cleanup();
      reject(new UploadValidationError(recoveryAttempted ? "Couldn't read this video's length" : "Couldn't read this video file"));
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

  // This is a hand-built multipart request rather than a generated
  // customFetch call, so it doesn't pick up the Authorization header
  // automatically — and /api/media/upload is requireAuth-gated. Attach the
  // same bearer token every other call sends, or uploads 401 wherever cookie
  // auth isn't the working credential (which is why the app moved to header
  // auth in the first place — see App.tsx's ClerkAuthTokenBridge).
  const token = await getAuthToken();
  const res = await fetch("/api/media/upload", {
    method: "POST",
    body: formData,
    headers: token ? { authorization: `Bearer ${token}` } : undefined,
  });
  const data = await res.json().catch(() => null);

  if (!res.ok) {
    throw new Error(data?.error ?? `Upload failed (${res.status})`);
  }

  return data as UploadedVideoResult;
}
