export const DELIVERY_METHOD_LABELS: Record<string, string> = {
  whisper_link: "Whisper Link",
  ghost_boost: "Ghost Boost",
  circle_drop: "Circle Drop",
};

export const WHISPER_CHANNEL_LABELS: Record<string, string> = {
  email: "Email",
  sms: "Text",
  whatsapp: "WhatsApp",
};

export function deliveryLabel(deliveryMethod: string, whisperChannel?: string | null): string {
  const base = DELIVERY_METHOD_LABELS[deliveryMethod] ?? deliveryMethod;
  if (deliveryMethod === "whisper_link" && whisperChannel && WHISPER_CHANNEL_LABELS[whisperChannel]) {
    return `${base} (${WHISPER_CHANNEL_LABELS[whisperChannel]})`;
  }
  return base;
}
