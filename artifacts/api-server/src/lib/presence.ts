// Online-presence — deliberately narrow in scope, and NOT wired into Whisper
// Links or Text Whisps at all. This app's whole product is built around
// anonymity between a sender and an anonymous recipient, and the codebase
// enforces one absolute, unconditional rule everywhere: a whisp/text-whisp's
// recipientUserId is NEVER exposed to the sender via the API — not even
// after an accepted Reveal (see routes/whisps.ts's toWhispResponse comment:
// "the same thing PATCH /:id/reveal deliberately withholds even when a
// reveal is accepted"). Reveal is a permission grant for some other,
// out-of-band disclosure; it does not relax what this API will return.
// Computing "is the recipient online" from recipientUserId — in either
// direction, at any point — would break that invariant, and would hand back
// exactly the live proximity/timing signal
// lib/replyNotificationScheduler.ts's randomized 3/5/9-minute reply-
// notification delay was built specifically to hide.
//
// So presence is visible ONLY where the other party's account is already
// non-anonymously, mutually known by product design: Debate Now, between a
// follower and an account they follow. A whispererHandle is a persistent,
// opt-in-followable pseudonym on purpose (see lib/whispererHandle.ts) — not
// an anonymity boundary — so surfacing presence there adds nothing an
// attacker didn't already have.
export const ONLINE_WINDOW_MS = 5 * 60 * 1000;

export function isOnline(lastSeenAt: Date | null | undefined): boolean {
  if (!lastSeenAt) return false;
  return Date.now() - lastSeenAt.getTime() <= ONLINE_WINDOW_MS;
}

// The single reciprocal rule: a viewer who has turned their own visibility
// off can't see anyone else's status either, and no one can see theirs.
// Returns null (not a boolean) when presence isn't showable at all — the
// frontend renders nothing for null rather than a false "offline" dot, since
// "off/unknown" and "genuinely offline" are different facts.
export function presenceFor(
  viewer: { showOnlineStatus: boolean },
  other: { showOnlineStatus: boolean; lastSeenAt: Date | null } | null | undefined,
): boolean | null {
  if (!viewer.showOnlineStatus || !other || !other.showOnlineStatus) return null;
  return isOnline(other.lastSeenAt);
}
