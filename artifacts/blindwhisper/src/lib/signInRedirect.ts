// Carries a signed-out visitor's deep link (an in-app page they were sent
// to — almost always from a notification email or push: /whisps/:id,
// /text-whisps/:id, /replies…) through the sign-in hop, so signing in lands
// them on that page instead of a generic /dashboard. Before this, every
// protected route bounced a signed-out visitor to the landing page and the
// sign-in page always forced /dashboard: the link they actually tapped was
// simply lost.
//
// The target rides as ?redirect_url= on /sign-in (the same parameter name
// Clerk itself uses), and is mirrored into sessionStorage because Clerk's
// own multi-step sign-in (/sign-in/factor-one, /sign-in/sso-callback…) is
// not guaranteed to keep our query string along the way. Same one-shot,
// current-tab-only handoff as lib/pendingInvite.ts.
const STORAGE_KEY = "blindwhisper:signInRedirect";
const PARAM = "redirect_url";

/**
 * Only an in-app absolute PATH is ever honoured — never a full URL,
 * protocol-relative "//host" or "/\host" (both of which browsers treat as
 * another origin), and never the auth pages themselves (a loop). Anything
 * else means "no deep link", i.e. the normal /dashboard landing.
 */
export function safeRedirectPath(raw: string | null | undefined): string | null {
  if (!raw || raw.length > 2048) return null;
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) return null;
  if (/[\u0000-\u001f]/.test(raw)) return null;
  if (/^\/(sign-in|sign-up)(\/|\?|$)/.test(raw)) return null;
  return raw;
}

/** The /sign-in URL that will return to `path` once the visitor has signed in. */
export function signInUrlFor(path: string): string {
  const safe = safeRedirectPath(path);
  return safe ? `/sign-in?${PARAM}=${encodeURIComponent(safe)}` : "/sign-in";
}

/**
 * Where the sign-in page should send the visitor afterwards (relative to
 * the app's base path). `subPath` = Clerk is on one of its own follow-up
 * steps (/sign-in/factor-one…) rather than the entry page: only then is the
 * remembered target trusted, so opening /sign-in fresh later in the same
 * tab never resurrects an old deep link.
 */
export function signInRedirectTarget(search: string, subPath: boolean): string {
  const fromQuery = safeRedirectPath(new URLSearchParams(search).get(PARAM));
  try {
    if (fromQuery) {
      sessionStorage.setItem(STORAGE_KEY, fromQuery);
      return fromQuery;
    }
    if (!subPath) {
      sessionStorage.removeItem(STORAGE_KEY);
      return "/dashboard";
    }
    return safeRedirectPath(sessionStorage.getItem(STORAGE_KEY)) ?? "/dashboard";
  } catch {
    // Storage blocked (private mode): the query string alone still works
    // for the common one-step sign-in.
    return fromQuery ?? "/dashboard";
  }
}
