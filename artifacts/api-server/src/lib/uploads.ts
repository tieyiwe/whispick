// Uploaded clips are kept short and small on purpose: short so they load
// fast for a recipient on a mobile connection, small so a sender's storage
// footprint (and this server's request memory) stays bounded regardless of
// how long a video actually runs. The file-size cap is the real enforcement
// boundary — durationSeconds is client-reported and trusted the same way
// this app already trusts client-supplied video metadata for pasted-URL
// whisps (see routes/video.ts's oEmbed scrape, never re-verified at send
// time either).
export const MAX_UPLOAD_DURATION_SECONDS = 120;
export const MAX_UPLOAD_VIDEO_BYTES = 30 * 1024 * 1024;
export const MAX_UPLOAD_THUMBNAIL_BYTES = 2 * 1024 * 1024;
export const ALLOWED_UPLOAD_VIDEO_MIME_TYPES = ["video/mp4", "video/webm", "video/quicktime"] as const;

// Retention: uploaded originals are phased out this many days after upload —
// comfortably longer than a whisp's own 48h link expiry plus its reminder
// window (see lib/expiration.ts), so a phase-out can never delete something
// a recipient hasn't had a chance to open yet.
export const UPLOAD_RETENTION_DAYS = 7;
// How long before deletion to warn the owner, so they have a real chance to
// save a copy if they still want one.
export const UPLOAD_DELETION_WARNING_DAYS = 2;

export function computeUploadExpiresAt(from: Date = new Date()): Date {
  return new Date(from.getTime() + UPLOAD_RETENTION_DAYS * 24 * 60 * 60 * 1000);
}
