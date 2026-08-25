import { reportBug } from "@workspace/api-client-react";

// BugRabbit's frontend capture — the client half of the in-house error
// tracker (see artifacts/api-server/src/lib/bugRabbit.ts for the backend
// half: fingerprinting, PII scrubbing, and the issue/occurrence grouping).
// Imported once for its module-level side effect (the two window listeners
// at the bottom), same pattern App.tsx's own lib/installApp import uses —
// it needs to be live from the moment the app boots, not from whenever some
// lazily-loaded route happens to mount.

const THROTTLE_KEY = "blindwhisper:bugRabbitLastSent";
const THROTTLE_WINDOW_MS = 60_000;

// A cheap client-side fingerprint — doesn't need to match the server's own
// fingerprintFor() exactly (that one's the real grouping key); this one only
// has to be stable enough to recognize "I already just sent this" within a
// short window, so a render loop that keeps throwing the same error doesn't
// fire a network request on every single re-render.
function clientFingerprint(message: string, stack?: string): string {
  const basis = `${message}|${(stack ?? "").split("\n").slice(0, 3).join("|")}`;
  let hash = 0;
  for (let i = 0; i < basis.length; i++) {
    hash = (hash * 31 + basis.charCodeAt(i)) | 0;
  }
  return String(hash);
}

function recentlySent(fingerprint: string): boolean {
  try {
    const raw = sessionStorage.getItem(THROTTLE_KEY);
    const sent: Record<string, number> = raw ? JSON.parse(raw) : {};
    const last = sent[fingerprint];
    if (last && Date.now() - last < THROTTLE_WINDOW_MS) return true;
    sent[fingerprint] = Date.now();
    // Unbounded growth isn't a real risk (sessionStorage clears on tab
    // close and this only ever holds distinct-error fingerprints from one
    // session), but cap it anyway so a genuinely pathological page can't
    // slowly bloat sessionStorage across a very long-lived tab.
    const entries = Object.entries(sent);
    if (entries.length > 200) {
      const trimmed = Object.fromEntries(entries.slice(-100));
      sessionStorage.setItem(THROTTLE_KEY, JSON.stringify(trimmed));
    } else {
      sessionStorage.setItem(THROTTLE_KEY, JSON.stringify(sent));
    }
    return false;
  } catch {
    // No sessionStorage (private mode, locked-down profile) — fall through
    // and just send every time; the server's own rate limiter is the real
    // backstop against abuse either way.
    return false;
  }
}

/** Reports one caught error to BugRabbit. Safe to call from anywhere,
 *  including inside another error handler — never throws, and self-
 *  throttles per fingerprint so a crash loop doesn't spam the network. */
export function reportErrorToBugRabbit(message: string, stack?: string | null): void {
  try {
    if (!message) return;
    const fingerprint = clientFingerprint(message, stack ?? undefined);
    if (recentlySent(fingerprint)) return;

    void reportBug({
      message,
      ...(stack ? { stack } : {}),
      url: window.location.pathname,
    }).catch(() => {});
  } catch {
    // A failure IN the error-reporting path must never become a second
    // error for this same handler to catch.
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("error", (event) => {
    // Ignore plain resource-load failures (a broken <img>, a font 404) —
    // event.error is only populated for actual script exceptions, so this
    // naturally filters those out.
    if (!event.error) return;
    const error = event.error instanceof Error ? event.error : new Error(String(event.error));
    reportErrorToBugRabbit(error.message, error.stack);
  });

  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    const error = reason instanceof Error ? reason : new Error(typeof reason === "string" ? reason : "Unhandled promise rejection");
    reportErrorToBugRabbit(error.message, error.stack);
  });
}
