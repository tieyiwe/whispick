export const DELIVERY_METHOD_LABELS: Record<string, string> = {
  whisper_link: "Whisper Link",
  ghost_boost: "Ghost Boost",
  circle_drop: "Blind Circle",
  group_whisper: "Group Whisper",
  // A private conversation an anonymous Circle viewer started with the
  // poster (see routes/public.ts's POST /w/:token/circle-dm/start) — not
  // something the sender chose to send, so it needs its own label rather
  // than reading as an ordinary outbound whisp.
  circle_dm: "Circle conversation",
};

export const WHISPER_CHANNEL_LABELS: Record<string, string> = {
  email: "Email",
  sms: "Text",
  whatsapp: "WhatsApp",
};

export function deliveryLabel(deliveryMethod: string, whisperChannel?: string | null): string {
  const base = DELIVERY_METHOD_LABELS[deliveryMethod] ?? deliveryMethod;
  const usesChannel = deliveryMethod === "whisper_link" || deliveryMethod === "group_whisper";
  if (usesChannel && whisperChannel && WHISPER_CHANNEL_LABELS[whisperChannel]) {
    return `${base} (${WHISPER_CHANNEL_LABELS[whisperChannel]})`;
  }
  return base;
}
