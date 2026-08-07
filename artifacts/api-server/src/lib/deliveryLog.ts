import { randomUUID } from "crypto";
import { db, deliveryAttemptsTable } from "@workspace/db";
import { logger } from "./logger";

// What a send was FOR — not just which whisp it's tied to. The same whisp
// can rack up several attempts across its life (the initial send, one per
// reminder), and a few purposes aren't the recipient-facing link at all (a
// reply/appreciation notification back to the sender).
export type DeliveryPurpose =
  | "whisper_link"
  | "reminder"
  | "ghost_boost_match"
  | "reply_notification"
  | "appreciation_notification"
  | "subscription_verification"
  | "media_expiring"
  | "reveal_request"
  | "reply_to_recipient";

export type DeliveryLogContext = {
  // Nullable at the type level for sends that aren't about any one whisp
  // (subscription verification, media-expiring reminders) — pass `null`
  // explicitly there rather than omitting it, so it's clear that's
  // deliberate and not a caller that forgot to look the id up.
  whispId: string | null;
  purpose: DeliveryPurpose;
};

export type DeliveryOutcome = {
  success: boolean;
  providerMessageId?: string | null;
  providerStatus?: string | null;
  errorMessage?: string | null;
};

// Persists one row per outbound send attempt so admins can see exactly what
// happened to a message — accepted, or why it failed — without SSH access to
// read server logs (see lib/sms.ts / lib/email.ts, which previously only
// logged this). Never throws: a logging failure must not take down the send
// path that called it.
export async function logDeliveryAttempt(
  channel: "email" | "sms" | "whatsapp",
  toAddress: string,
  ctx: DeliveryLogContext,
  outcome: DeliveryOutcome,
): Promise<void> {
  try {
    await db.insert(deliveryAttemptsTable).values({
      id: randomUUID(),
      whispId: ctx.whispId,
      channel,
      purpose: ctx.purpose,
      toAddress,
      success: outcome.success,
      providerMessageId: outcome.providerMessageId ?? null,
      providerStatus: outcome.providerStatus ?? null,
      errorMessage: outcome.errorMessage ?? null,
    });
  } catch (err) {
    logger.error({ err, channel, purpose: ctx.purpose }, "Failed to record delivery attempt");
  }
}
