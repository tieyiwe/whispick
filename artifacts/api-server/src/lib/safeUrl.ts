import { z } from "zod";

// Guards every client-supplied URL that the frontend will later render as a
// clickable href, iframe src, or window.open target. React does NOT block
// javascript: URLs in href, so accepting an arbitrary string here becomes
// stored XSS in whoever views it (the whisp's sender for reply videoUrls, an
// admin for whisp videoUrls). Note that z.string().url() is NOT sufficient
// for this — "javascript:alert(1)" parses as a perfectly valid URL; the
// protocol check is the part that matters.
export function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

// Zod building block for route schemas: a string that must parse as an
// absolute http(s) URL. The .max is just payload hygiene — nothing
// legitimate approaches 2 KB.
export const httpUrlString = z.string().max(2048).refine(isHttpUrl, { message: "Must be an http(s) URL" });

// For URLs that may legitimately be in-app relative paths (admin-authored
// notification links like "/whisps/abc"): allow those, plus absolute
// http(s), and nothing else. "//host" is excluded because it's a
// protocol-relative *external* URL, not an app path — and so is "/\host":
// browsers treat a backslash like a slash, so "/\evil.com" resolves to
// https://evil.com. Backslashes and control characters are rejected
// outright, and an app path must still resolve to the SAME origin.
// Returns the normalized href (what should be stored/used), or null.
const PLACEHOLDER_BASE = "https://app.invalid";
// eslint-disable-next-line no-control-regex
const UNSAFE_URL_CHARS = /[\\\u0000-\u001f\u007f\s]/;

export function normalizeHttpUrlOrAppPath(raw: string): string | null {
  const value = raw.trim();
  if (UNSAFE_URL_CHARS.test(value)) return null;
  if (value.startsWith("/")) {
    if (value.startsWith("//")) return null;
    try {
      const parsed = new URL(value, PLACEHOLDER_BASE);
      if (parsed.origin !== PLACEHOLDER_BASE) return null;
      return `${parsed.pathname}${parsed.search}${parsed.hash}`;
    } catch {
      return null;
    }
  }
  if (!isHttpUrl(value)) return null;
  return new URL(value).href;
}

export function isHttpUrlOrAppPath(value: string): boolean {
  return normalizeHttpUrlOrAppPath(value) !== null;
}
