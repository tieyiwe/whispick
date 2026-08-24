import { Flame, Ghost, Star, Zap, Moon, Sun, Feather, Sparkles, type LucideIcon } from "lucide-react";

// Mirrors artifacts/api-server/src/lib/avatars.ts's AVATAR_IDS exactly — the
// id strings are the wire format (users.whispererAvatarId,
// anonymous_handles.avatarId), so every string here must match the backend
// byte-for-byte even though this file alone owns how each one renders.
// Kept in sync by hand, same pattern as GENDER_OPTIONS/VIDEO_CATEGORIES
// elsewhere in this app.
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

const ICONS: Record<string, LucideIcon> = {
  flame: Flame,
  ghost: Ghost,
  star: Star,
  zap: Zap,
  moon: Moon,
  sun: Sun,
  feather: Feather,
  sparkles: Sparkles,
};

// Solid Tailwind shades, same violet/amber/rose accent trio already used
// around the app (StatusBadge.tsx, MoodTag.tsx, the Debate stats cards).
const BG_CLASSES: Record<string, string> = {
  violet: "bg-violet-500",
  amber: "bg-amber-500",
  rose: "bg-rose-500",
};

export function isKnownAvatarId(value: string | null | undefined): value is AvatarId {
  return !!value && (AVATAR_IDS as readonly string[]).includes(value);
}

export function avatarIcon(id: AvatarId): LucideIcon {
  const theme = id.split("-")[0]!;
  return ICONS[theme]!;
}

export function avatarBgClass(id: AvatarId): string {
  const color = id.split("-")[1]!;
  return BG_CLASSES[color]!;
}
