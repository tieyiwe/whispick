import { pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// A Sender's standing attestation that they have one specific Recipient's
// permission to text them via Blind Whisper — captured once, at the first
// SMS send to that number, via the required opt-in checkbox in
// SendWhisp/SendTextWhisp/InvitePage (see lib/smsConsent.ts and each send
// route). It exists so the Sender doesn't have to re-tick that box on every
// subsequent whisp to the same person: real opt-in consent is collected
// once and valid until revoked, not re-collected per message.
//
// This is deliberately a STORED, timestamped record rather than the old
// ephemeral per-send checkbox — that makes it real, auditable A2P 10DLC
// opt-in evidence (who consented to text whom, and when), which is stronger
// than an un-stored box that was merely re-ticked each time. Revocation is
// handled entirely separately and always wins: a phone number that has
// replied STOP is blocked platform-wide regardless of any row here, so a
// stored consent can never be used to keep texting someone who opted out.
//
// Scoped per (senderId, recipientPhone) — the phone is stored normalized to
// E.164 so "the same number" is recognized however the Sender typed it. Not
// tied to a recipient *account*: the whole point is that a Text Whisp/whisp
// can go to any phone number, account or not, and consent is about the
// number the Sender is texting, not about whether it belongs to a user.
export const smsConsentsTable = pgTable("sms_consents", {
  id: text("id").primaryKey(),
  senderId: text("sender_id").notNull(),
  // E.164-normalized (see lib/phone.ts's normalizePhoneE164) so a repeat
  // send recognizes the same recipient no matter the formatting used.
  recipientPhone: text("recipient_phone").notNull(),
  consentedAt: timestamp("consented_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("sms_consents_sender_phone_idx").on(table.senderId, table.recipientPhone),
]);

export const insertSmsConsentSchema = createInsertSchema(smsConsentsTable).omit({ consentedAt: true });
export type InsertSmsConsent = z.infer<typeof insertSmsConsentSchema>;
export type SmsConsent = typeof smsConsentsTable.$inferSelect;
