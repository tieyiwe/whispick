import { pgTable, text, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Replies on a Text Whisp (see text_whisps.ts). Unlike whisp_replies.ts's
// boolean fromRecipient flag — needed there because a whisp reply can come
// from an unauthenticated anonymous recipient — every reply here comes from
// an authenticated, known account, so we just record senderId directly and
// compare it against the parent text_whisps row's senderId/recipientUserId
// to know which side sent it (see routes/textWhisps.ts).
export const textWhispRepliesTable = pgTable("text_whisp_replies", {
  id: text("id").primaryKey(),
  textWhispId: text("text_whisp_id").notNull(),
  senderId: text("sender_id").notNull(),
  // Max 260 chars, same limit and same enforcement point (Zod, at the route
  // layer) as text_whisps.messageText.
  replyText: text("reply_text").notNull(),
  // Which earlier message in the SAME thread this answers, if any — same
  // "quote a specific message" feature whisp_replies.parentReplyId gives
  // video Whisps, via the same shared ReplyThread component
  // (components/shared/ReplyThread.tsx). Not a foreign key: a stale/missing
  // id just degrades to an unquoted reply (see ReplyThread's own comment),
  // same tolerance whisp_replies takes.
  parentReplyId: text("parent_reply_id"),
  // WhatsApp-style read receipt for the OTHER party's messages — set when
  // the recipient of THIS reply (whichever side of the conversation didn't
  // write it) opens the thread. See routes/textWhisps.ts's GET /:id.
  readAt: timestamp("read_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("text_whisp_replies_text_whisp_id_idx").on(table.textWhispId),
]);

export const insertTextWhispReplySchema = createInsertSchema(textWhispRepliesTable).omit({ createdAt: true });
export type InsertTextWhispReply = z.infer<typeof insertTextWhispReplySchema>;
export type TextWhispReply = typeof textWhispRepliesTable.$inferSelect;
