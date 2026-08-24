import { pgTable, text, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// The Whisper Box — the platform's "pull" growth loop: a signed-in user
// opts in (users.whisperBoxEnabled) and gets a public page at
// /whisper-box/:whispererHandle where literally anyone, WITHOUT an account,
// can send them one short anonymous message. This is deliberately unlike
// every other send path in the app (Whisper Link, Text Whisp, Whisper
// Group), all of which require the SENDER to be a signed-in, accountable
// Whisperer — here the sender is anonymous by design, meant to be shared on
// a public bio link the same way NGL/Sarahah/tbh grew.
//
// That inversion has real consequences reflected in the shape below:
//   - No senderId at all. There is no account to attribute this to, so
//     there is no way to warn/ban an author for a bad message the way
//     moderation.ts's maybeWarnUser does elsewhere — a flagged message can
//     only ever be removed from the recipient's box, never traced back.
//   - No reply channel. Nothing points back to the sender (no phone, no
//     account, no email) — unlike Text Whisps' guest link, there is
//     nothing to reply TO. The recipient can only read and delete.
//   - senderAlias is purely decorative flavor text the sender typed
//     (mirrors whisps.senderAlias / textWhisps.senderAlias) — never an
//     identity, and never validated against anything.
export const whisperBoxMessagesTable = pgTable("whisper_box_messages", {
  id: text("id").primaryKey(),
  recipientUserId: text("recipient_user_id").notNull(),
  // Max 500 chars — enforced by Zod at the route layer (a bit more room
  // than a Text Whisp's 260, since this is meant to hold a fuller anonymous
  // question/note rather than a quick text).
  messageText: text("message_text").notNull(),
  senderAlias: text("sender_alias"),
  status: text("status").notNull().default("unread"), // 'unread' | 'read'
  readAt: timestamp("read_at", { withTimezone: true }),
  // Admin takedown (moderation_flags.ts's contentType 'whisper_box_message')
  // — distinct from the recipient's own delete, same accountability
  // reasoning as whisps.removedByAdminAt.
  removedByAdminAt: timestamp("removed_by_admin_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("whisper_box_messages_recipient_user_id_idx").on(table.recipientUserId),
]);

export const insertWhisperBoxMessageSchema = createInsertSchema(whisperBoxMessagesTable).omit({ createdAt: true });
export type InsertWhisperBoxMessage = z.infer<typeof insertWhisperBoxMessageSchema>;
export type WhisperBoxMessage = typeof whisperBoxMessagesTable.$inferSelect;
