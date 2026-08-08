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
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("text_whisp_replies_text_whisp_id_idx").on(table.textWhispId),
]);

export const insertTextWhispReplySchema = createInsertSchema(textWhispRepliesTable).omit({ createdAt: true });
export type InsertTextWhispReply = z.infer<typeof insertTextWhispReplySchema>;
export type TextWhispReply = typeof textWhispRepliesTable.$inferSelect;
