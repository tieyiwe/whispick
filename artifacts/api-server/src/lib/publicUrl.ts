import type { Request } from "express";

// A syntactically valid host[:port] — letters/digits/dots/hyphens, optional
// port. Anything else (commas from a multi-value X-Forwarded-Host, CRLF,
// path/query characters, an embedded @) is rejected so a spoofed or injected
// header can't shape the host we build outbound links from.
const HOST_PATTERN = /^[a-zA-Z0-9.-]+(?::\d+)?$/;

function firstHeaderValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  // A header can arrive as "a.com, b.com" through chained proxies — only the
  // first hop is the one we (may) trust.
  return value?.split(",")[0]?.trim();
}

/**
 * Base URL of the public-facing frontend, used to build links embedded in
 * emails/SMS and Stripe redirect URLs. The frontend proxies /api/* to this
 * server, so absent an explicit override the request's forwarded host is the
 * frontend's own public origin.
 *
 * SECURITY: when PUBLIC_APP_URL is unset, the host comes from a client-
 * supplied header. That header ends up as the domain in links texted/emailed
 * to third-party recipients, so an attacker spoofing X-Forwarded-Host could
 * make the real service send a victim a real, valid token pointed at an
 * attacker domain. Two defenses here: (1) the host is validated against
 * HOST_PATTERN so it can't carry injected commas/CRLF/paths, and (2)
 * PUBLIC_APP_URL should always be set in production (the schedulers already
 * require it) so this fallback is never used for delivered links at all.
 */
export function getPublicAppUrl(req: Request): string {
  const override = process.env.PUBLIC_APP_URL;
  if (override) return override.replace(/\/$/, "");

  const rawProto = firstHeaderValue(req.headers["x-forwarded-proto"]) ?? req.protocol ?? "https";
  const protocol = rawProto === "http" || rawProto === "https" ? rawProto : "https";

  const forwardedHost = firstHeaderValue(req.headers["x-forwarded-host"]);
  const rawHost = forwardedHost ?? firstHeaderValue(req.headers.host) ?? "localhost";
  const host = HOST_PATTERN.test(rawHost) ? rawHost : "localhost";

  return `${protocol}://${host}`;
}
