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

// A whisp built from an uploaded video can't be scheduled further out than
// this — otherwise "Schedule for later" could land after the video's own
// retention window (UPLOAD_RETENTION_DAYS) has already phased it out,
// handing the recipient a dead link the moment it's delivered. Left with a
// couple of days' margin below the retention window rather than cutting it
// exactly at the edge. (lib/scheduler.ts also re-checks the media's status
// at actual dispatch time, as a second line of defense — this cap just
// keeps that from being the only thing standing between a sender and a
// broken send.)
export const MAX_SCHEDULE_DAYS_WITH_UPLOAD = UPLOAD_RETENTION_DAYS - UPLOAD_DELETION_WARNING_DAYS;

export function computeUploadExpiresAt(from: Date = new Date()): Date {
  return new Date(from.getTime() + UPLOAD_RETENTION_DAYS * 24 * 60 * 60 * 1000);
}

// A quick magic-byte sanity check — the client-supplied mimetype is trusted
// for what Content-Type we later serve the file back as (it's validated
// against ALLOWED_UPLOAD_VIDEO_MIME_TYPES first, so it can never become
// something browser-dangerous like text/html), but without this, someone
// could still park arbitrary non-video bytes behind an unguessable public
// link labeled as a video. Not a full container-format validator — just
// enough to reject an obvious mismatch.
export function looksLikeDeclaredVideoFormat(buffer: Buffer, mimeType: string): boolean {
  if (mimeType === "video/mp4" || mimeType === "video/quicktime") {
    // ISO base media file format (mp4, mov, ...): a 4-byte size field
    // followed by an "ftyp" box type, normally within the first few bytes.
    return buffer.length >= 8 && buffer.subarray(4, 8).toString("ascii") === "ftyp";
  }
  if (mimeType === "video/webm") {
    // EBML header magic number, used by both WebM and Matroska.
    return buffer.length > 4 && buffer[0] === 0x1a && buffer[1] === 0x45 && buffer[2] === 0xdf && buffer[3] === 0xa3;
  }
  return false;
}
