// requireAdmin (api-server) returns 403 { error, code: "admin_mfa_required" }
// for any admin-role account that doesn't have Clerk 2FA enabled, checked
// live on every /api/admin/* request. That can land on ANY admin query or
// mutation across ANY admin page — not just the first one on mount — so
// rather than have every admin page duplicate its own "am I locked out"
// check, queryClient.ts's QueryCache/MutationCache onError funnels every
// such failure through markAdminMfaRequired() here, and AdminRoute renders
// a single full-page explanation whenever this flag is set, regardless of
// which admin page or request tripped it.
let mfaRequired = false;
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

export function isAdminMfaRequiredError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const data = (error as { data?: unknown }).data;
  if (!data || typeof data !== "object") return false;
  return (data as { code?: unknown }).code === "admin_mfa_required";
}

export function markAdminMfaRequired(): void {
  if (mfaRequired) return;
  mfaRequired = true;
  notify();
}

// Called when an admin heads off to set up 2FA and comes back — the next
// admin request either succeeds (nothing re-marks the flag) or fails again
// (markAdminMfaRequired re-sets it), so this is safe to call optimistically.
export function clearAdminMfaRequired(): void {
  if (!mfaRequired) return;
  mfaRequired = false;
  notify();
}

export function getAdminMfaRequiredSnapshot(): boolean {
  return mfaRequired;
}

export function subscribeAdminMfaRequired(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
