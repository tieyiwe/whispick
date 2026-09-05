import { pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// A stable, anonymous display name for one Sender, from the perspective of
// one Recipient — "Falcon482", not an account name. Generated the first
// time that Sender's identity would otherwise be shown to that Recipient
// (see lib/whispSenderHandle.ts's assignOrGetSenderHandle, called from
// routes/whisps.ts, routes/public.ts's GET /w/:token, and
// routes/textWhisps.ts), so a Recipient who gets whisps/Text Whisps from
// several different people can tell them apart across a whole inbox full
// of separate, otherwise-identical "anonymous" messages — without any of
// it being a real identity.
//
// Scoped per (senderId, recipientUserId) — deliberately NOT global, and
// deliberately asymmetric: the Sender already knows who the Recipient is
// (they typed the phone/email in themselves), so there's no privacy
// property to protect on that side. The Recipient must never be able to
// learn who the Sender is, which this doesn't change — a handle is a
// pseudonym, not an identity leak — but it also must never let two
// DIFFERENT Recipients compare notes and realize they share a common
// Sender, which per-recipient scoping prevents by construction: the same
// real Sender gets a different, independently-random handle for every
// Recipient they've ever sent to.
//
// One shared table for both delivery types (Whisp and Text Whisp) rather
// than a separate one each — senderId is drawn from the same users table
// either way, so if the same person sends a Recipient both a video and a
// text note, they reasonably show up as the same handle for both, not two
// unrelated ones.
export const whispSenderHandlesTable = pgTable("whisp_sender_handles", {
  id: text("id").primaryKey(),
  senderId: text("sender_id").notNull(),
  recipientUserId: text("recipient_user_id").notNull(),
  handle: text("handle").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("whisp_sender_handles_sender_recipient_idx").on(table.senderId, table.recipientUserId),
  // Backs the "is this handle already showing for a different sender in
  // this recipient's inbox" collision check the generator relies on — two
  // different senders must never end up looking like the same person to
  // one recipient.
  uniqueIndex("whisp_sender_handles_recipient_handle_idx").on(table.recipientUserId, table.handle),
]);

export const insertWhispSenderHandleSchema = createInsertSchema(whispSenderHandlesTable).omit({ createdAt: true });
export type InsertWhispSenderHandle = z.infer<typeof insertWhispSenderHandleSchema>;
export type WhispSenderHandle = typeof whispSenderHandlesTable.$inferSelect;
