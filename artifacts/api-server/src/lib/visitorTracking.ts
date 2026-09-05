import { lookupGeoIp } from "./geoip";

// A ping older than this no longer counts as "currently on the platform" —
// short enough to read as genuinely live, long enough to comfortably survive
// a few missed pings (tab backgrounded, a slow network blip) without a
// visitor flickering in and out of the count. PING_INTERVAL_MS on the
// frontend is what actually keeps a row fresh; this window just needs to be
// a multiple of it with margin.
export const VISITOR_ONLINE_WINDOW_MS = 2 * 60 * 1000;

// A stable key a ping upserts onto, so one visitor's row updates in place
// instead of the table growing one row per ping forever (see
// visitor_sessions.ts's own comment). Exactly one of userId/visitorId is
// ever passed — the caller (routes/visitorPing.ts) already enforces that.
export function sessionKeyFor(userId: string | null, visitorId: string | null): string {
  return userId ? `u:${userId}` : `v:${visitorId}`;
}

// ip-api.com's free tier (lib/geoip.ts) has no API key and is rate-limited
// — fine for a lookup once per signup, not for a lookup on every heartbeat
// ping from a live-visitor roster. This cache is what makes the two
// compatible: a repeat ping from the same IP within TTL never leaves the
// process. In-memory and per-instance is an accepted tradeoff (same as
// every other "best effort, never blocks anything" geo lookup in this
// codebase) — a cache miss after a restart or on another instance just
// costs one more real lookup, not a correctness problem.
const GEO_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const geoCache = new Map<string, { country: string | null; expiresAt: number }>();

export async function cachedCountryForIp(ip: string | undefined): Promise<string | null> {
  if (!ip) return null;

  const cached = geoCache.get(ip);
  if (cached && cached.expiresAt > Date.now()) return cached.country;

  const location = await lookupGeoIp(ip);
  const country = location?.country ?? null;
  geoCache.set(ip, { country, expiresAt: Date.now() + GEO_CACHE_TTL_MS });
  return country;
}
