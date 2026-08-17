import { pgTable, text, boolean, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// A durable log of every outbound email/SMS/WhatsApp send this app makes,
// success or failure. Twilio/Resend responses only ever confirmed "accepted
// and queued" or an error, and until this table existed that confirmation
// only ever reached our own server logs (see lib/sms.ts, lib/email.ts) —
// invisible to admins without SSH access, and useless for answering "did my
// whisp actually go out?" days later. whispId is nullable because a few
// sends aren't about any one whisp (Ghost Boost subscription verification,
// media-expiring reminders); everything whisp-shaped (Whisper Link/Group
// Whisper delivery, reminders, reply/appreciation notifications, Ghost Boost
// match delivery) sets it so admins can pull a whisp's full delivery
// history, and a user's, in one query.
export const deliveryAttemptsTable = pgTable("delivery_attempts", {
  id: text("id").primaryKey(),
  whispId: text("whisp_id"),
  channel: text("channel").notNull(), // 'email' | 'sms' | 'whatsapp' | 'in_app' (matched-recipient sms/whatsapp routed in-app instead of Twilio — see lib/deliver.ts)
  // What this send was FOR, not just which whisp it's attached to — the same
  // whisp can have several attempts across its life (initial send, one per
  // reminder), and some purposes aren't the recipient-facing link at all
  // (a reply/appreciation notification back to the sender).
  purpose: text("purpose").notNull(), // 'whisper_link' | 'reminder' | 'ghost_boost_match' | 'reply_notification' | 'appreciation_notification' | 'subscription_verification' | 'media_expiring'
  toAddress: text("to_address").notNull(),
  success: boolean("success").notNull(),
  // Twilio message SID or Resend email id — lets support cross-reference a
  // specific send in the provider's own dashboard.
  providerMessageId: text("provider_message_id"),
  // Twilio's queued/accepted status string on success, or the provider's
  // error body (truncated) on failure.
  providerStatus: text("provider_status"),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("delivery_attempts_whisp_id_idx").on(table.whispId),
]);

export const insertDeliveryAttemptSchema = createInsertSchema(deliveryAttemptsTable).omit({ createdAt: true });
export type InsertDeliveryAttempt = z.infer<typeof insertDeliveryAttemptSchema>;
export type DeliveryAttempt = typeof deliveryAttemptsTable.$inferSelect;
