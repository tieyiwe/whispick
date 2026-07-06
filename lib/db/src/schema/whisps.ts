import { pgTable, text, timestamp, boolean, numeric } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const whispsTable = pgTable("whisps", {
  id: text("id").primaryKey(),
  senderId: text("sender_id").notNull(),
  videoUrl: text("video_url").notNull(),
  videoTitle: text("video_title"),
  videoThumbnail: text("video_thumbnail"),
  videoPlatform: text("video_platform"), // 'youtube' | 'tiktok' | 'instagram' | 'facebook' | 'other'
  deliveryMethod: text("delivery_method").notNull(), // 'whisper_link' | 'ghost_boost'
  recipientEmail: text("recipient_email"),
  recipientPhone: text("recipient_phone"),
  recipientMetaAudienceId: text("recipient_meta_audience_id"),
  anonymousNote: text("anonymous_note"),
  senderAlias: text("sender_alias"),
  moodTag: text("mood_tag"),
  status: text("status").notNull().default("pending"),
  publicToken: text("public_token").unique().notNull(),
  scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
  deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  openedAt: timestamp("opened_at", { withTimezone: true }),
  watchedAt: timestamp("watched_at", { withTimezone: true }),
  revealRequested: boolean("reveal_requested").notNull().default(false),
  revealAccepted: boolean("reveal_accepted"),
  boostSpendUsd: numeric("boost_spend_usd", { precision: 6, scale: 2 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertWhispSchema = createInsertSchema(whispsTable).omit({ createdAt: true });
export type InsertWhisp = z.infer<typeof insertWhispSchema>;
export type Whisp = typeof whispsTable.$inferSelect;
