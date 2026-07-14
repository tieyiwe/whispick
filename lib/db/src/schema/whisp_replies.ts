import { pgTable, text, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const whispRepliesTable = pgTable("whisp_replies", {
  id: text("id").primaryKey(),
  whispId: text("whisp_id").notNull(),
  replyText: text("reply_text").notNull(),
  fromRecipient: boolean("from_recipient").notNull().default(true),
  // A "whisp back" — the recipient can reply with their own video instead of
  // (or alongside) text, keeping the anonymous exchange going both ways.
  videoUrl: text("video_url"),
  videoTitle: text("video_title"),
  videoThumbnail: text("video_thumbnail"),
  videoEmbedUrl: text("video_embed_url"),
  videoPlatform: text("video_platform"),
  moodTag: text("mood_tag"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertWhispReplySchema = createInsertSchema(whispRepliesTable).omit({ createdAt: true });
export type InsertWhispReply = z.infer<typeof insertWhispReplySchema>;
export type WhispReply = typeof whispRepliesTable.$inferSelect;
