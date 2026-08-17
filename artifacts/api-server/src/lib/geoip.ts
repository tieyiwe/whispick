const PRIVATE_IP_PREFIXES = ["127.", "10.", "192.168.", "::1", "fc", "fd"];

function isPrivateIp(rawIp: string): boolean {
  // Node reports loopback/private IPv4 addresses reached over a dual-stack
  // socket in IPv4-mapped IPv6 form (e.g. "::ffff:127.0.0.1"), which none of
  // the plain-IPv4 prefixes below would match — strip that prefix first.
  const normalized = rawIp.toLowerCase().replace(/^::ffff:/, "");
  return PRIVATE_IP_PREFIXES.some((prefix) => normalized.startsWith(prefix)) || normalized.startsWith("172.");
}

export type GeoLocation = { country: string | null; region: string | null; city: string | null };

// Best-effort, no-API-key IP geolocation for admin analytics (see users.ts —
// country/region/city are captured once at signup). ip-api.com's free tier
// is plaintext HTTP only and rate-limited; a failure here should never block
// signup, so every error path just resolves to null.
export async function lookupGeoIp(ip: string): Promise<GeoLocation | null> {
  if (!ip || isPrivateIp(ip)) return null;

  try {
    const res = await fetch(`http://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,country,regionName,city`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { status: string; country?: string; regionName?: string; city?: string };
    if (data.status !== "success") return null;
    return {
      country: data.country ?? null,
      region: data.regionName ?? null,
      city: data.city ?? null,
    };
  } catch {
    return null;
  }
}
