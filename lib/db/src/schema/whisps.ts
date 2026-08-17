import { pgTable, text, timestamp, boolean, numeric, integer, index } from "drizzle-orm/pg-core";
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
  // Optional trim point — playback is paused (and treated as complete) once
  // reached, instead of implying "watch the whole thing." Enforced in JS by
  // VideoPlayer.tsx, not a platform embed param, so it behaves identically
  // across YouTube/Vimeo/native-upload playback. Only meaningful alongside
  // videoStartSeconds/on embeddable platforms — a no-op everywhere else,
  // same as the start bookmark.
  videoEndSeconds: integer("video_end_seconds"),
  videoPlatform: text("video_platform"), // 'youtube' | 'tiktok' | 'instagram' | 'facebook' | 'vimeo' | 'upload' | 'other'
  // Set when the video came from the sender's own Media Library (an
  // upload) instead of a pasted URL — see uploaded_videos.ts. videoUrl is
  // still populated (a non-dereferenced "upload:<id>" marker, since the
  // column is NOT NULL) but is never itself navigated to; playback goes
  // through /public/w/:token/media instead, scoped by token possession like
  // everything else public-facing here.
  uploadedVideoId: text("uploaded_video_id"),
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
  // Urgency framing for whisper_link/group_whisper deliveries only (no
  // specific recipient to notify for circle_drop/ghost_boost, so those stay
  // null). Set at actual delivery time, not creation time, so a scheduled
  // whisp's countdown starts when it's really sent. Reminders re-notify the
  // recipient over the same channel before expiresAt, capped at
  // MAX_REMINDERS (see lib/expiration.ts) — they don't push the deadline
  // back, only re-surface it.
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  reminderCount: integer("reminder_count").notNull().default(0),
  nextReminderAt: timestamp("next_reminder_at", { withTimezone: true }),
  lastReminderAt: timestamp("last_reminder_at", { withTimezone: true }),
  boostSpendUsd: numeric("boost_spend_usd", { precision: 6, scale: 2 }),
  // Extra anonymous replies the SENDER has bought for this specific whisp, on
  // top of the free allowance (see lib/plans.ts recipientReplyAllowance). An
  // anonymous recipient can only reply so many times before the thread closes
  // — the sender is then offered more. Deliberately per-whisp rather than a
  // per-user balance: the purchase is about keeping one particular
  // conversation alive, and a shared pool would let one runaway thread drain
  // credits meant for another. Never a cap on a recipient who signs up —
  // membership removes the limit entirely.
  replyCreditsPurchased: integer("reply_credits_purchased").notNull().default(0),
  // A short, therapist-toned "takeaway" of the video's message, generated for
  // the RECIPIENT (not the sender) once they finish watching, or proactively
  // if they haven't watched after a while so the gist is there whenever they
  // do open it (see lib/aiTakeaway.ts). Transcript-based, so only ever
  // populated for platforms we can get a transcript from (YouTube today) —
  // 'unavailable' covers both "no transcript" and a failed generation.
  aiTakeaway: text("ai_takeaway"),
  aiTakeawayStatus: text("ai_takeaway_status"), // null (not attempted yet) | 'ready' | 'unavailable'
  aiTakeawayGeneratedAt: timestamp("ai_takeaway_generated_at", { withTimezone: true }),
  // Set when this whisp's video and/or note came from the "Not sure what to
  // send?" AI concierge (see lib/concierge.ts, concierge_requests.ts) —
  // null for every whisp composed the normal manual way. Purely an
  // analytics correlation (routes/admin.ts's funnel stats use it to answer
  // "did concierge suggestions actually lead to a send"), never read on any
  // send/delivery path.
  conciergeRequestId: text("concierge_request_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  // Soft delete, sender-initiated: hides the whisp (and its reply thread)
  // from the sender's own list/detail/dashboard views, without touching the
  // row itself — admins can still see everything for support purposes (see
  // routes/admin.ts, which never filters on this). Doesn't affect the
  // Recipient's own public link, which keeps working as already delivered.
  deletedBySenderAt: timestamp("deleted_by_sender_at", { withTimezone: true }),
}, (table) => [
  // publicToken already gets an index for free from its unique() constraint
  // above — not duplicated here. The rest back the admin panel's list/detail
  // queries (routes/admin.ts) and the sender-scoped lookups every
  // user-facing whisp list/dashboard query does (routes/whisps.ts).
  index("whisps_sender_id_idx").on(table.senderId),
  index("whisps_status_idx").on(table.status),
  index("whisps_recipient_email_idx").on(table.recipientEmail),
  index("whisps_recipient_phone_idx").on(table.recipientPhone),
  index("whisps_concierge_request_id_idx").on(table.conciergeRequestId),
]);

export const insertWhispSchema = createInsertSchema(whispsTable).omit({ createdAt: true });
export type InsertWhisp = z.infer<typeof insertWhispSchema>;
export type Whisp = typeof whispsTable.$inferSelect;
