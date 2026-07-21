import { pgTable, text, timestamp, boolean, numeric, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const whispsTable = pgTable("whisps", {
  id: text("id").primaryKey(),
  senderId: text("sender_id").notNull(),
  videoUrl: text("video_url").notNull(),
  videoTitle: text("video_title"),
  videoThumbnail: text("video_thumbnail"),
  videoEmbedUrl: text("video_embed_url"), // set for platforms with an embeddable player (YouTube, Vimeo) — powers real watch tracking
  videoStartSeconds: integer("video_start_seconds"), // optional timestamp bookmark — playback starts here instead of 0
  videoPlatform: text("video_platform"), // 'youtube' | 'tiktok' | 'instagram' | 'facebook' | 'vimeo' | 'other'
  // Best-effort captions text, fetched after send to confirm/refine the video's
  // category tags (see lib/categorize.ts). Only ever populated for platforms
  // we can scrape captions from (currently YouTube); null otherwise.
  videoTranscript: text("video_transcript"),
  deliveryMethod: text("delivery_method").notNull(), // 'whisper_link' | 'ghost_boost' | 'circle_drop' | 'group_whisper'
  whisperChannel: text("whisper_channel"), // 'email' | 'sms' | 'whatsapp' — set when deliveryMethod is 'whisper_link' or 'group_whisper'
  circleId: text("circle_id"), // set for circle_drop whisps posted to a private Circle instead of the public feed
  // A group_whisper send fans out to one whisp row per group member (each
  // gets its own token/tracking/reply thread, same as a normal Whisper
  // Link) — groupSendId ties all of them back together as one logical send
  // for the sender's UI. whisperGroupId records which saved group was used,
  // for display only; it's not re-queried for who received THIS send, since
  // group membership can change after the fact.
  groupSendId: text("group_send_id"),
  whisperGroupId: text("whisper_group_id"),
  recipientEmail: text("recipient_email"),
  recipientPhone: text("recipient_phone"),
  anonymousNote: text("anonymous_note"),
  senderAlias: text("sender_alias"),
  moodTag: text("mood_tag"),
  status: text("status").notNull().default("pending"), // ... | 'scheduled' (scheduledAt is in the future; a background dispatcher delivers it when due)
  publicToken: text("public_token").unique().notNull(),
  scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
  deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  openedAt: timestamp("opened_at", { withTimezone: true }),
  watchedAt: timestamp("watched_at", { withTimezone: true }),
  revealRequested: boolean("reveal_requested").notNull().default(false),
  revealAccepted: boolean("reveal_accepted"),
  // The recipient's own answer to "was this something you needed to hear?" —
  // 'yes' | 'no'. Distinct from watch/reply tracking: this is an explicit,
  // one-tap signal of whether the whisp actually landed, and a 'yes'
  // notifies the sender (see lib/push.ts, routes/public.ts).
  appreciationResponse: text("appreciation_response"),
  appreciationRespondedAt: timestamp("appreciation_responded_at", { withTimezone: true }),
  boostSpendUsd: numeric("boost_spend_usd", { precision: 6, scale: 2 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertWhispSchema = createInsertSchema(whispsTable).omit({ createdAt: true });
export type InsertWhisp = z.infer<typeof insertWhispSchema>;
export type Whisp = typeof whispsTable.$inferSelect;
