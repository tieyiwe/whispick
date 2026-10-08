import { pgTable, text, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// A Debate Now topic sent point-to-point to one contact — "Whisper this
// topic" on DebateTopicDetail.tsx, as opposed to that same button's old
// plain native-share/copy-link behavior (still offered alongside this, not
// removed). Deliberately NOT stored in whisps.ts (whisps.videoUrl is NOT
// NULL and the rest of that table is built around a video being the point
// of the message — see text_whisps.ts's identical reasoning for why IT
// isn't in whisps.ts either) and deliberately NOT a full text_whisps-style
// mini-app: a Text Whisp needed its own reply thread/typing-indicator/
// reveal-flow machinery because the message text itself only lives on that
// one thread. A debate topic already has a permanent, fully public,
// anonymous-comment-capable landing page (`/debate-topics/:id` —
// DebateTopicDetail.tsx, reachable without an account via visitorId, see
// lib/anonymousVisitor.ts) — so sending one is closer to Invites (a single
// delivery record, no publicToken/guest-page/reply-thread of its own) than
// to a Text Whisp. This table is that delivery record.
//
// Unlike an Invite, BOTH email and phone (SMS/WhatsApp) channels are
// offered — a debate topic isn't gated to "people who might not have the
// app yet" the way an invite is, so there's no reason to restrict the
// channel choice the way Text Whisps do (phone-only, since that feature's
// whole guest-SMS-link path depends on it).
//
// No reveal flow (yet) — the sender is always anonymous to the recipient,
// full stop, same as a Whisper Link before any reveal request exists for
// it. If a "let me reveal myself" feature is wanted here later, follow
// invites.ts's revealRequested/revealAccepted shape rather than inventing a
// new one.
export const debateTopicWhispsTable = pgTable("debate_topic_whisps", {
  id: text("id").primaryKey(),
  senderId: text("sender_id").notNull(),
  // Whoever is doing the whisping — not necessarily debate_topics.authorId.
  // Any signed-in viewer of a topic can whisp it to someone, same as any
  // viewer of a video whisp can "pass it forward"; it isn't restricted to
  // the topic's own author.
  debateTopicId: text("debate_topic_id").notNull(),
  // Set only when recipientEmail/recipientPhone matched a known, verified
  // Blind Whisper account at send time (see lib/deliver.ts's
  // findVerifiedRecipient(ByEmail)) — delivery then goes in-app too, same
  // dual-delivery behavior deliverWhisperLink gives a matched whisp
  // recipient. Null means "no match", same meaning as text_whisps.recipientUserId.
  recipientUserId: text("recipient_user_id"),
  recipientEmail: text("recipient_email"),
  recipientPhone: text("recipient_phone"),
  channel: text("channel").notNull(), // 'email' | 'sms' | 'whatsapp'
  // Optional line from the sender, shown alongside the topic teaser in the
  // email/SMS body — max 200 chars, enforced by Zod at the route layer
  // (routes/debateTopicWhisps.ts), same "not just a DB constraint" posture
  // as text_whisps.messageText's cap.
  note: text("note"),
  senderAlias: text("sender_alias"),
  status: text("status").notNull().default("sent"), // 'sent' | 'failed'
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("debate_topic_whisps_sender_id_idx").on(table.senderId),
  index("debate_topic_whisps_debate_topic_id_idx").on(table.debateTopicId),
]);

export const insertDebateTopicWhispSchema = createInsertSchema(debateTopicWhispsTable).omit({ createdAt: true });
export type InsertDebateTopicWhisp = z.infer<typeof insertDebateTopicWhispSchema>;
export type DebateTopicWhisp = typeof debateTopicWhispsTable.$inferSelect;
