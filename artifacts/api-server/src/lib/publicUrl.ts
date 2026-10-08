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

import { logger } from "./logger";

/**
 * Origin the request itself arrived on, from (validated) forwarded headers.
 * Only for comparisons like app.ts's same-origin CORS check — NEVER for
 * building links that leave this server (see getPublicAppUrl).
 */
export function requestOriginFromHeaders(req: Request): string {
  const rawProto = firstHeaderValue(req.headers["x-forwarded-proto"]) ?? req.protocol ?? "https";
  const protocol = rawProto === "http" || rawProto === "https" ? rawProto : "https";

  const forwardedHost = firstHeaderValue(req.headers["x-forwarded-host"]);
  const rawHost = forwardedHost ?? firstHeaderValue(req.headers.host) ?? "localhost";
  const host = HOST_PATTERN.test(rawHost) ? rawHost : "localhost";

  return `${protocol}://${host}`;
}

const PRODUCTION_FALLBACK_URL = "https://blindwhisper.com";
let warnedMissingPublicUrl = false;

function productionFallbackUrl(): string {
  if (!warnedMissingPublicUrl) {
    warnedMissingPublicUrl = true;
    logger.warn("PUBLIC_APP_URL is not set — building emailed/texted links from REPLIT_DOMAINS or the default domain. Set PUBLIC_APP_URL.");
  }
  const replitDomain = process.env.REPLIT_DOMAINS?.split(",")[0]?.trim();
  if (replitDomain && HOST_PATTERN.test(replitDomain)) return `https://${replitDomain}`;
  return PRODUCTION_FALLBACK_URL;
}

/**
 * Base URL of the public-facing frontend, used to build links embedded in
 * emails/SMS and Stripe redirect URLs.
 *
 * SECURITY: these links (carrying real, valid whisp/invite tokens) go to
 * third-party recipients, so their host must never come from a client-
 * supplied header — a spoofed X-Forwarded-Host would otherwise make the
 * real service send a victim a real token pointed at an attacker's domain.
 * Order: PUBLIC_APP_URL; in production, the first REPLIT_DOMAINS entry, else
 * the canonical domain (with a one-time warning to set PUBLIC_APP_URL).
 * Outside production the request's (validated) host is still used, so local
 * dev/preview links keep pointing at wherever the app is actually running.
 */
export function getPublicAppUrl(req: Request): string {
  const override = process.env.PUBLIC_APP_URL;
  if (override) return override.replace(/\/$/, "");
  if (process.env.NODE_ENV === "production") return productionFallbackUrl();
  return requestOriginFromHeaders(req);
}

// For callers with no request at all (emails rendered by background jobs).
export function configuredPublicAppUrl(): string {
  const override = process.env.PUBLIC_APP_URL;
  if (override) return override.replace(/\/$/, "");
  return productionFallbackUrl();
}
