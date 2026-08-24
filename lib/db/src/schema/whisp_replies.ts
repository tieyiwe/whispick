import { pgTable, text, boolean, timestamp, index } from "drizzle-orm/pg-core";
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
  // The message this one is answering, when it's a reply to a specific
  // earlier message rather than to the thread as a whole. Null for ordinary
  // messages, which is every row written before this existed.
  //
  // Deliberately a flat quote-reference, not a nested tree: the UI shows the
  // parent quoted above the reply and keeps one chronological thread. Real
  // nesting would need indentation rules, collapse states, and an answer for
  // deep chains — all of it overhead for a two-person conversation, where
  // "which message is this about" is the only question worth answering.
  // Constrained to a reply on the SAME whisp at write time (see routes),
  // since a reference across whisps would leak one thread into another.
  parentReplyId: text("parent_reply_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  // Deferred sender notification (see routes/public.ts's /reply handler and
  // lib/replyNotificationScheduler.ts): if the Sender and Recipient are
  // physically together, an instant "you got a reply" push would visibly
  // buzz the Sender's phone the moment the Recipient hits send, revealing
  // who the Sender is. notifySenderAt is set (only for fromRecipient=true
  // rows — sender-authored follow-ups inserted elsewhere don't use this) to
  // a random 3/5/9 minutes out at insert time to break that timing
  // correlation; senderNotifiedAt stays null until the scheduler actually
  // fires the deferred email + push, so null means "still pending".
  notifySenderAt: timestamp("notify_sender_at", { withTimezone: true }),
  senderNotifiedAt: timestamp("sender_notified_at", { withTimezone: true }),
  // WhatsApp-style read receipt: set the moment the OTHER party (not
  // whoever authored this row) loads a view containing it — the recipient's
  // GET /w/:token for a fromRecipient=false (sender-authored) row, or the
  // sender's GET /whisps/:id for a fromRecipient=true (recipient-authored)
  // one. Deliberately instant, not deferred like notifySenderAt above: that
  // delay exists specifically to break the timing correlation of a PUSH
  // notification physically buzzing a nearby phone the moment someone acts.
  // A read receipt is pull-based — the other party only ever sees it by
  // separately choosing to open their own view later — so there's no
  // equivalent proximity signal to protect against here.
  readAt: timestamp("read_at", { withTimezone: true }),
  // "Guess who sent it" light gamification (fromRecipient=true only — a
  // sender can't guess their own identity). The system NEVER auto-checks a
  // guess against the real sender: that would turn this into an
  // identity-enumeration oracle (try names one at a time, watch for
  // "correct"), which is exactly what this app's anti-enumeration posture
  // exists to prevent — see routes/whisps.ts's toWhispResponse comment.
  // Instead the sender manually picks a reaction, same trust model as the
  // Reveal handshake: the platform is a permission/reaction relay, never an
  // automated verifier of who anyone is.
  isGuess: boolean("is_guess").notNull().default(false),
  guessReaction: text("guess_reaction"), // 'hot' | 'cold' | 'no_comment' | 'confirmed', sender-set only
}, (table) => [
  index("whisp_replies_whisp_id_idx").on(table.whispId),
  index("whisp_replies_notify_sender_at_idx").on(table.notifySenderAt),
]);

export const insertWhispReplySchema = createInsertSchema(whispRepliesTable).omit({ createdAt: true });
export type InsertWhispReply = z.infer<typeof insertWhispReplySchema>;
export type WhispReply = typeof whispRepliesTable.$inferSelect;
