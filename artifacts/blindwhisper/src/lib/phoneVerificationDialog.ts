// Tracks whether this browser has already seen (and dismissed, or doesn't
// need) the phone-verification onboarding dialog (see
// components/shared/PhoneVerificationDialog.tsx) — "Shown once" for a
// dismissible nudge means "never nag again after the first dismissal," not
// "block until answered" (that's DemographicsGateDialog's job, which has no
// dismiss path). localStorage (not sessionStorage) is deliberate here,
// unlike lib/forwardVideo.ts's one-shot intent — this needs to persist
// across browser sessions so "Maybe later" actually means later, not just
// "later this tab". Keyed per-user (Clerk user id) since the same browser
// can be shared across accounts.
function storageKey(userId: string): string {
  return `blindwhisper:phoneVerificationDialogDismissed:${userId}`;
}

export function hasDismissedPhoneVerificationDialog(userId: string): boolean {
  try {
    return localStorage.getItem(storageKey(userId)) !== null;
  } catch {
    return false;
  }
}

export function dismissPhoneVerificationDialog(userId: string): void {
  try {
    localStorage.setItem(storageKey(userId), "1");
  } catch {
    // Private-browsing/storage-disabled edge case — worst case the dialog
    // resurfaces next visit, not a functional failure.
  }
}
