// Tracks whether this browser has already seen (and dismissed) the "send
// your first Whispers to a few friends at once" onboarding CTA card on
// Dashboard.tsx — same "dismiss once, don't nag again" contract as
// phoneVerificationDialog.ts, mirrored here rather than shared with it
// since the two nudges are independent and can be dismissed on different
// schedules. localStorage (not sessionStorage): this needs to persist
// across browser sessions, and is keyed per-user (Clerk-backed user id) so
// a shared browser doesn't leak one account's dismissal into another's.
function storageKey(userId: string): string {
  return `blindwhisper:firstWhispersCtaDismissed:${userId}`;
}

export function hasDismissedFirstWhispersCta(userId: string): boolean {
  try {
    return localStorage.getItem(storageKey(userId)) !== null;
  } catch {
    return false;
  }
}

export function dismissFirstWhispersCta(userId: string): void {
  try {
    localStorage.setItem(storageKey(userId), "1");
  } catch {
    // Private-browsing/storage-disabled edge case — worst case the card
    // resurfaces next visit, not a functional failure.
  }
}
