import { pgTable, text, boolean, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// A "Text Whisp": a short, text-only anonymous message — the user-to-user
// counterpart to a Whisper Link, deliberately NOT stored in whisps.ts.
// whisps.videoUrl is NOT NULL and the rest of that table is built around a
// video being the point of the message; a pure-text note doesn't fit there
// and retrofitting it was ruled out as out of scope. Both senderId and
// recipientUserId are always real, known Blind Whisper accounts — unlike a
// whisp, there's no email/SMS/anonymous-recipient path here at all (see
// routes/textWhisps.ts's POST /check-recipient, which is the only way a
// sender learns whether someone is even eligible before composing).
// Delivery is exclusively in-app (lib/push.ts's notifyUser + notificationsTable
// — see routes/textWhisps.ts), never Twilio/Resend.
//
// Still fully anonymous to the recipient: senderAlias is shown, never the
// real sender identity, unless a Reveal Flow (below) is requested and
// accepted — and even then, mirroring whisps.ts's exact behavior, accepting
// only grants *permission*; it doesn't itself inject the sender's real name
// anywhere (see routes/textWhisps.ts's reveal endpoints).
export const textWhispsTable = pgTable("text_whisps", {
  id: text("id").primaryKey(),
  senderId: text("sender_id").notNull(),
  recipientUserId: text("recipient_user_id").notNull(),
  senderAlias: text("sender_alias"),
  // Max 260 chars — enforced by Zod at the route layer (see
  // routes/textWhisps.ts), not just implied by a DB constraint, so a bad
  // request fails fast with a clear error instead of a generic DB error.
  messageText: text("message_text").notNull(),
  status: text("status").notNull().default("sent"), // 'sent' | 'read' | 'replied'
  revealRequested: boolean("reveal_requested").notNull().default(false),
  revealAccepted: boolean("reveal_accepted"),
  readAt: timestamp("read_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  // Soft delete, sender-initiated — exact same semantics as
  // whisps.deletedBySenderAt: hides this text whisp from the sender's own
  // list/detail views without touching the row (or its replies) at all.
  // Admins still see everything for support/abuse-report purposes (see
  // routes/admin.ts, which never filters on this). Doesn't affect the
  // recipient's own view — they keep seeing it as before.
  deletedBySenderAt: timestamp("deleted_by_sender_at", { withTimezone: true }),
}, (table) => [
  index("text_whisps_sender_id_idx").on(table.senderId),
  index("text_whisps_recipient_user_id_idx").on(table.recipientUserId),
]);

export const insertTextWhispSchema = createInsertSchema(textWhispsTable).omit({ createdAt: true });
export type InsertTextWhisp = z.infer<typeof insertTextWhispSchema>;
export type TextWhisp = typeof textWhispsTable.$inferSelect;
