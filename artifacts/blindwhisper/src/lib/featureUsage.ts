import { getAuthToken } from "@workspace/api-client-react";

// Internal product analytics, capture side: which buttons/features actually
// get used. Zero-instrumentation by design — every interactive element in
// this app already carries a data-testid, so a single capture-phase click
// listener turns those ids into feature keys. Volatile id segments (uuids,
// long digit runs) are normalized to "*" so `button-like-<uuid>` counts as
// one feature, not thousands. Counts aggregate locally and flush in small
// batches — one request per window, never one per click, and never
// blocking anything user-facing.
//
// No content, no URLs, no coordinates — feature key counts only.

const FLUSH_INTERVAL_MS = 20_000;
const MAX_BATCH = 50;

const pending = new Map<string, number>();
let started = false;
let flushTimer: ReturnType<typeof setInterval> | null = null;

function normalizeFeatureKey(testid: string): string | null {
  const key = testid
    .toLowerCase()
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, "*")
    .replace(/[0-9a-f]{16,}/g, "*")
    .replace(/\d{4,}/g, "*")
    .replace(/\*(-\*)+/g, "*");
  if (!/^[a-z0-9*][a-z0-9*_.:-]{0,99}$/.test(key)) return null;
  return key;
}

function record(event: Event): void {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const el = target.closest("[data-testid]");
  if (!el) return;
  const key = normalizeFeatureKey(el.getAttribute("data-testid") ?? "");
  if (!key) return;
  pending.set(key, (pending.get(key) ?? 0) + 1);
}

async function flush(useKeepalive = false): Promise<void> {
  if (pending.size === 0) return;
  const events = [...pending.entries()].slice(0, MAX_BATCH).map(([feature, count]) => ({ feature, count: Math.min(count, 500) }));
  pending.clear();

  try {
    const token = await getAuthToken();
    await fetch("/api/public/usage-events", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ events }),
      // keepalive lets the tab-close flush actually leave the browser.
      keepalive: useKeepalive,
    });
  } catch {
    // Analytics must never surface an error to the user — dropped events
    // are an acceptable cost.
  }
}

// Idempotent — App.tsx calls this once on mount.
export function initFeatureUsage(): void {
  if (started || typeof document === "undefined") return;
  started = true;
  document.addEventListener("click", record, { capture: true, passive: true });
  flushTimer = setInterval(() => void flush(), FLUSH_INTERVAL_MS);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") void flush(true);
  });
}

export function stopFeatureUsage(): void {
  if (!started) return;
  started = false;
  document.removeEventListener("click", record, { capture: true } as any);
  if (flushTimer) clearInterval(flushTimer);
}
