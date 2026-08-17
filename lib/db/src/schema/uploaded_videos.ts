import { pgTable, text, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// A sender's own uploaded video clips, reusable across multiple whisps (the
// "Media Library"). The original bytes live in object storage, not this
// table — objectKey/thumbnailObjectKey are just the storage path. Bytes are
// phased out UPLOAD_RETENTION_DAYS after upload (see lib/uploads.ts), well
// past any whisp's own 48h link expiry + reminder window, so a phased-out
// file never breaks a whisp someone hasn't opened yet. The row itself is
// never deleted (only status/deletedAt change), so a whisp's uploadedVideoId
// reference always resolves to *something* even after the bytes are gone.
export const uploadedVideosTable = pgTable("uploaded_videos", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  originalFilename: text("original_filename").notNull(),
  objectKey: text("object_key").notNull(),
  thumbnailObjectKey: text("thumbnail_object_key"),
  mimeType: text("mime_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  // Client-reported (captured from the browser's own video element before
  // upload) — trusted the same way this app already trusts client-supplied
  // video metadata for pasted-URL whisps (title/thumbnail from oEmbed
  // scraping isn't re-verified server-side either). The real enforcement
  // boundary against abuse is the hard file-size cap on upload, not this.
  durationSeconds: integer("duration_seconds"),
  status: text("status").notNull().default("ready"), // 'ready' | 'deleted' (owner removed it) | 'expired' (retention phase-out)
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  deletionWarnedAt: timestamp("deletion_warned_at", { withTimezone: true }),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertUploadedVideoSchema = createInsertSchema(uploadedVideosTable).omit({ createdAt: true });
export type InsertUploadedVideo = z.infer<typeof insertUploadedVideoSchema>;
export type UploadedVideo = typeof uploadedVideosTable.$inferSelect;
