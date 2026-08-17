// Carries an invite's public token from the (unauthenticated) public invite
// landing page (PublicInvitePage.tsx) through the Clerk sign-up hop, so the
// backend can attribute the resulting brand-new account back to this
// specific invite (POST /api/invites/claim, fired by
// ClaimPendingInvite.tsx once signed in). Same one-shot sessionStorage
// handoff pattern as lib/forwardVideo.ts's "pass it forward", and for the
// same reason — this is a one-shot intent for the current tab, not
// something that should linger across browser sessions.
const STORAGE_KEY = "blindwhisper:pendingInvite";

export function savePendingInvite(token: string): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, token);
  } catch {
    // Private-browsing/storage-disabled edge case — attribution just won't
    // happen; not worth failing the "join" flow over.
  }
}

// Read-and-clear: consumed exactly once, so returning to the app later
// never re-fires a claim for a stale token.
export function takePendingInvite(): string | null {
  try {
    const token = sessionStorage.getItem(STORAGE_KEY);
    if (!token) return null;
    sessionStorage.removeItem(STORAGE_KEY);
    return token;
  } catch {
    return null;
  }
}
