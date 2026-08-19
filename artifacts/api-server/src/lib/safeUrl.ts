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
// protocol-relative *external* URL, not an app path.
export function isHttpUrlOrAppPath(value: string): boolean {
  if (value.startsWith("/") && !value.startsWith("//")) return true;
  return isHttpUrl(value);
}
