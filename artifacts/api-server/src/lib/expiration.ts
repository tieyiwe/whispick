// Only whisper_link and group_whisper deliveries get an expiration — there's
// a specific recipient to create urgency for and notify with a reminder.
// circle_drop/ghost_boost have no single recipient, so they never expire.
export const WHISP_EXPIRATION_HOURS = 48;

export const MAX_REMINDERS = 2;

export const REMINDER_PRESETS = [
  { key: "1h", label: "In 1 hour", minutes: 60 },
  { key: "4h", label: "In 4 hours", minutes: 4 * 60 },
  { key: "1d", label: "Tomorrow", minutes: 24 * 60 },
] as const;

export function computeExpiresAt(from: Date = new Date()): Date {
  return new Date(from.getTime() + WHISP_EXPIRATION_HOURS * 60 * 60 * 1000);
}

export function isExpired(expiresAt: Date | string | null): boolean {
  if (!expiresAt) return false;
  return new Date(expiresAt).getTime() <= Date.now();
}
