// The admin panel's second-factor gate, client side. requireAdmin
// (api-server lib/adminAuth.ts) returns 403 with one of two codes for any
// admin-role account:
//
//   "admin_mfa_setup_required" — no authenticator enrolled yet
//   "admin_mfa_code_required"  — enrolled, but this session hasn't entered
//                                a code (or its unlock token expired)
//
// That can land on ANY admin query or mutation across ANY admin page, so
// queryClient.ts's QueryCache/MutationCache onError funnels every such
// failure through markAdminMfaState() here, and AdminRoute renders one
// full-page enrollment or code-entry screen whenever the state is set. The
// unlock token a verified code earns lives in sessionStorage (this tab's
// session only — closing the tab re-locks the panel, which is the right
// default for an admin surface) and is attached to every request as the
// X-Admin-Mfa header via the api client's setExtraHeadersGetter.

export type AdminMfaState = "setup" | "code" | null;

const TOKEN_STORAGE_KEY = "bw_admin_mfa_token";

let mfaState: AdminMfaState = null;
const listeners = new Set<() => void>();

// Subscribers hear about BOTH kinds of change — mfaState transitions and
// token store/clear — so AdminRoute can useSyncExternalStore over either
// snapshot. Without the token side, a cold-opened tab (mfaState already
// null, token missing) would never re-render after a successful verify:
// clearAdminMfaState early-returns, and nothing else notices the token
// landing in sessionStorage.
function notify(): void {
  for (const listener of listeners) listener();
}

export function adminMfaStateFromError(error: unknown): AdminMfaState {
  if (!error || typeof error !== "object") return null;
  const data = (error as { data?: unknown }).data;
  if (!data || typeof data !== "object") return null;
  const code = (data as { code?: unknown }).code;
  if (code === "admin_mfa_setup_required") return "setup";
  if (code === "admin_mfa_code_required") return "code";
  return null;
}

export function markAdminMfaState(state: Exclude<AdminMfaState, null>): void {
  // A code_required response also means whatever token we hold is no good
  // anymore — drop it so the retry after re-entry starts clean.
  if (state === "code") clearAdminMfaToken();
  if (mfaState === state) return;
  mfaState = state;
  notify();
}

// Called after a successful verify (token stored) — the next admin request
// either succeeds or re-marks the state, so clearing optimistically is safe.
export function clearAdminMfaState(): void {
  if (mfaState === null) return;
  mfaState = null;
  notify();
}

export function getAdminMfaStateSnapshot(): AdminMfaState {
  return mfaState;
}

export function subscribeAdminMfaState(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getAdminMfaToken(): string | null {
  try {
    return sessionStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function storeAdminMfaToken(token: string): void {
  try {
    sessionStorage.setItem(TOKEN_STORAGE_KEY, token);
  } catch {
    // Storage unavailable (private mode edge cases) — the in-memory-only
    // consequence is just re-entering a code after a hard reload.
  }
  notify();
}

export function clearAdminMfaToken(): void {
  try {
    sessionStorage.removeItem(TOKEN_STORAGE_KEY);
  } catch {
    // ignore
  }
  notify();
}
