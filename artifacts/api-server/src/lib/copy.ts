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

// Re-notification copy for a "remind me later" follow-up. `isFinal` marks
// the last reminder a whisp is allowed (see lib/expiration.ts's
// MAX_REMINDERS) — that one has to say so explicitly and give the real
// deadline, since there's no reminder after it.
export function reminderHookLine(isFinal: boolean, expiresAt: Date): string {
  if (isFinal) {
    const when = expiresAt.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
    return `Last reminder — the anonymous whisp you were sent won't be available after ${when}.`;
  }
  return "Don't forget — you have an anonymous whisp waiting for you 👀";
}

// Sent when a Sender clicks "Reveal Yourself" on an already-delivered whisp
// (see routes/whisps.ts POST /:id/reveal). Deliberately gives away nothing —
// no name, no hint — the suspense is the point; the actual accept/decline
// choice (and, if accepted, the sender following up to say who they are) all
// happens on the public whisp page this links to. Keep in sync with
// PublicWhispPage.tsx's reveal-section copy the same way as HOOK_LINE.
export function revealRequestHookLine(): string {
  return "Someone who sent you an anonymous whisp wants to reveal who they are... 👀";
}

// Ghost Boost match delivery — deliberately doesn't say "a stranger sent
// this" (true, but a colder framing than the rest of the app's copy) or
// imply the sender picked THEM specifically (they didn't — a subscriber
// opted in to a topic, and this matched it). Keep in sync with
// PublicWhispPage.tsx the same way as HOOK_LINE.
export function matchHookLine(): string {
  return "This matched something you said you wanted to hear about — sent anonymously 👀";
}
