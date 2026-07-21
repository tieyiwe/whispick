// Canonical hook line shown to recipients — keep the frontend's copy
// (PublicWhispPage.tsx lead text) in sync with this by hand; the two
// packages don't share a constants module.
export const HOOK_LINE = "Someone who cares about you thought you needed to see this 👀";

// Group Whisper variant — deliberately vague about who else is in the group
// (a headcount, never names) so no single member feels personally targeted,
// even if one of them was the "real" reason it was sent. Keep in sync with
// PublicWhispPage.tsx the same way as HOOK_LINE.
export function groupHookLine(memberCount: number): string {
  return `Someone in your circle sent this anonymously — you're one of ${memberCount} people who got it 👀`;
}
