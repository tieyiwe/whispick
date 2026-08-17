// Browser-API layer for Step 1's "Camera" tab (SendWhisp.tsx) — thin
// wrappers around getUserMedia + MediaRecorder, no third-party library.
// Everything this module produces is a plain File, fed into
// uploadMedia.ts's *existing* pipeline unchanged, so retention (see
// lib/uploads.ts's UPLOAD_RETENTION_DAYS), moderation, and playback all
// stay identical to a file picked via "Upload" — there is no parallel
// media pipeline here.
//
// Photos: the Whisp data model is video-only today (whisps.videoUrl is
// NOT NULL, and every recipient-facing surface — VideoPlayer.tsx,
// WhispDetail.tsx, PublicWhispPage.tsx — assumes video playback semantics:
// duration, play/pause, a <video> element). Rather than thread a
// still-image code path through all of that, a captured "photo" is
// synthesized client-side into a short, silent, static-frame video clip
// (canvas.captureStream + MediaRecorder, recorded in realtime — there's no
// ffmpeg/wasm encoder available here, see routes/media.ts) using the same
// MIME types the upload pipeline already accepts. It then flows through as
// an ordinary uploaded video with zero backend changes.
export const PHOTO_CLIP_DURATION_SECONDS = 4;

// Checked once up front so the Camera tab can show a clear, permanent
// message (and leave Upload/Paste a link fully usable) instead of only
// discovering "this can't work" after the user already tapped something.
export function getCameraUnsupportedReason(): string | null {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return "Camera capture isn't available.";
  }
  // getUserMedia requires a secure context (HTTPS, or localhost in dev).
  // Production is HTTPS-only, so this should never actually trigger there —
  // it's here so a misconfigured/http deployment fails with a clear message
  // instead of a confusing "no camera" one.
  if (!window.isSecureContext) {
    return "Camera capture needs a secure (HTTPS) connection — it isn't available here.";
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    return "This browser doesn't support camera capture. Try Upload instead.";
  }
  if (typeof MediaRecorder === "undefined") {
    return "This browser can't record video. Try Upload instead.";
  }
  return null;
}

export function isCameraCaptureSupported(): boolean {
  return getCameraUnsupportedReason() === null;
}

export function isPhotoClipSupported(): boolean {
  return typeof HTMLCanvasElement !== "undefined" && typeof HTMLCanvasElement.prototype.captureStream === "function";
}

const RECORDER_MIME_CANDIDATES = [
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
  "video/webm",
  "video/mp4",
] as const;

export interface RecorderMimeChoice {
  recordType: string;
  // The bare MIME type (no codecs suffix) that uploadMedia.ts's
  // ALLOWED_UPLOAD_VIDEO_MIME_TYPES exact-matches against — MediaRecorder's
  // own blob.type mirrors whatever (possibly codec-qualified) string was
  // passed to its constructor, so the produced File's type is always
  // explicitly overridden to this instead.
  uploadMimeType: "video/webm" | "video/mp4";
  extension: "webm" | "mp4";
}

// Picks the best MediaRecorder output this browser actually supports.
// Chrome/Firefox support webm (vp9 preferred, vp8 fallback); Safari 14.1+
// supports mp4 directly. Both are already in the Upload tab's accepted
// formats, so nothing downstream needs to know capture happened via camera.
export function pickRecorderMimeType(): RecorderMimeChoice | null {
  if (typeof MediaRecorder === "undefined") return null;
  for (const candidate of RECORDER_MIME_CANDIDATES) {
    if (MediaRecorder.isTypeSupported(candidate)) {
      const isMp4 = candidate.startsWith("video/mp4");
      return {
        recordType: candidate,
        uploadMimeType: isMp4 ? "video/mp4" : "video/webm",
        extension: isMp4 ? "mp4" : "webm",
      };
    }
  }
  return null;
}

// Records whatever is currently painted on `canvas` for `durationSeconds`,
// producing a real, container-valid video Blob. This runs in realtime (a
// MediaRecorder can't be sped up) — callers should show a "Preparing…"
// state for the duration rather than blocking the UI.
export function encodeCanvasAsClip(canvas: HTMLCanvasElement, recordType: string, durationSeconds: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    let stream: MediaStream;
    try {
      // A low frame rate is plenty for a static frame — this is a photo,
      // not motion video, so there's nothing to gain from capturing faster.
      stream = canvas.captureStream(5);
    } catch (err) {
      reject(err instanceof Error ? err : new Error("Couldn't process the photo"));
      return;
    }

    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream, { mimeType: recordType, videoBitsPerSecond: 800_000 });
    } catch (err) {
      stream.getTracks().forEach((t) => t.stop());
      reject(err instanceof Error ? err : new Error("Couldn't process the photo"));
      return;
    }

    const chunks: BlobPart[] = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };
    recorder.onerror = () => {
      stream.getTracks().forEach((t) => t.stop());
      reject(new Error("Couldn't process the photo"));
    };
    recorder.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      resolve(new Blob(chunks, { type: recordType }));
    };
    recorder.start();
    setTimeout(() => {
      if (recorder.state !== "inactive") recorder.stop();
    }, durationSeconds * 1000);
  });
}

// Human-readable messages for the getUserMedia rejections a sender can
// actually hit — permission prompts, missing/busy hardware. Anything
// unrecognized falls back to a generic retry message rather than surfacing
// a raw DOMException name.
export function describeGetUserMediaError(err: unknown): string {
  const name = err instanceof DOMException ? err.name : undefined;
  switch (name) {
    case "NotAllowedError":
    case "PermissionDeniedError":
      return "Camera access was denied. Allow camera access for this site in your browser settings, then try again.";
    case "NotFoundError":
    case "DevicesNotFoundError":
      return "No camera was found on this device.";
    case "NotReadableError":
    case "TrackStartError":
      return "Your camera is already in use by another app. Close it and try again.";
    case "OverconstrainedError":
      return "This device doesn't support that camera. Try flipping the camera.";
    case "SecurityError":
      return "Camera capture isn't allowed in this context.";
    default:
      return "Couldn't access the camera. Please try again.";
  }
}

export function formatMMSS(totalSeconds: number): string {
  const mins = Math.floor(totalSeconds / 60);
  const secs = Math.floor(totalSeconds % 60);
  return `${mins}:${String(secs).padStart(2, "0")}`;
}
