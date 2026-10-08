// Launch-time kill switches for the two Twilio-backed delivery channels.
//
// US carriers' A2P 10DLC review rejected our SMS campaign (third-party
// consent — a Sender attesting on a recipient's behalf — isn't an allowed
// opt-in model), so a cold SMS/WhatsApp to a number that never opted in
// would just fail. Both channels ship OFF; email, in-app delivery and
// copyable share links carry launch. Re-enable by setting the env var to
// "true" once a compliant campaign is approved — no code change needed.
//
// Read on every call (not cached at module load) so tests and a config
// reload can flip them without re-importing. Only the exact string "true"
// (any case) enables: a typo or an empty value must fail closed.
//
// NOT used for phone-number verification (lib/phoneVerification.ts — a user
// verifying their OWN number via Twilio Verify is first-party and stays on).

function envFlag(name: string): boolean {
  return (process.env[name] ?? "").trim().toLowerCase() === "true";
}

export function isSmsDeliveryEnabled(): boolean {
  return envFlag("SMS_DELIVERY_ENABLED");
}

export function isWhatsAppDeliveryEnabled(): boolean {
  return envFlag("WHATSAPP_DELIVERY_ENABLED");
}

export const SMS_DISABLED_ERROR = "SMS delivery isn't available yet — send by email instead.";
export const WHATSAPP_DISABLED_ERROR = "WhatsApp delivery isn't available yet — send by email instead.";

// Stable machine-readable code alongside the human message, so the
// frontend can special-case it (e.g. fall back to the email picker) without
// string-matching the copy.
export const CHANNEL_DISABLED_CODE = "channel_disabled";

// Intake-time check for a requested phone channel. Returns the 400 body to
// send, or null when the channel is allowed (or isn't a phone channel at
// all — email/in-app callers can pass their channel straight through).
export function disabledChannelError(
  channel: string | null | undefined,
): { error: string; code: typeof CHANNEL_DISABLED_CODE } | null {
  if (channel === "sms" && !isSmsDeliveryEnabled()) return { error: SMS_DISABLED_ERROR, code: CHANNEL_DISABLED_CODE };
  if (channel === "whatsapp" && !isWhatsAppDeliveryEnabled()) {
    return { error: WHATSAPP_DISABLED_ERROR, code: CHANNEL_DISABLED_CODE };
  }
  return null;
}

export function isPhoneChannelEnabled(channel: "sms" | "whatsapp"): boolean {
  return channel === "sms" ? isSmsDeliveryEnabled() : isWhatsAppDeliveryEnabled();
}
