// Mirrors artifacts/api-server/src/lib/expiration.ts's REMINDER_PRESETS —
// keep both lists in sync if the offered times ever change.
export const REMINDER_PRESETS = [
  { key: "1h", label: "In 1 hour", minutes: 60 },
  { key: "4h", label: "In 4 hours", minutes: 4 * 60 },
  { key: "1d", label: "Tomorrow", minutes: 24 * 60 },
] as const;

export const MAX_REMINDERS = 2;
