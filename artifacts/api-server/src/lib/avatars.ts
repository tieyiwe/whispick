import { randomInt } from "crypto";

// A curated library of preset avatars for the Debate Topics anonymous
// identity (users.whispererAvatarId, anonymous_handles.avatarId) — no file
// upload path exists at all, deliberately: this identity must never carry
// a real photo. The frontend renders each id as an icon-on-color circle
// (artifacts/blindwhisper/src/lib/avatars.ts, kept in sync by hand — same
// convention as GENDER_OPTIONS/VIDEO_CATEGORIES elsewhere in this app); the
// backend only ever needs to know which ids are valid to accept.
export const AVATAR_IDS = [
  "flame-violet", "flame-amber", "flame-rose",
  "ghost-violet", "ghost-amber", "ghost-rose",
  "star-violet", "star-amber", "star-rose",
  "zap-violet", "zap-amber", "zap-rose",
  "moon-violet", "moon-amber", "moon-rose",
  "sun-violet", "sun-amber", "sun-rose",
  "feather-violet", "feather-amber", "feather-rose",
  "sparkles-violet", "sparkles-amber", "sparkles-rose",
] as const;
export type AvatarId = (typeof AVATAR_IDS)[number];

export function isValidAvatarId(value: string): value is AvatarId {
  return (AVATAR_IDS as readonly string[]).includes(value);
}

export function randomAvatarId(): AvatarId {
  return AVATAR_IDS[randomInt(AVATAR_IDS.length)];
}
