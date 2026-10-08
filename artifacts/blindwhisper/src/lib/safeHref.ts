// Guards for rendering stored, partly user-supplied URLs as clickable links.
// The write paths validate these server-side (api-server lib/safeUrl.ts), but
// rows written before that validation existed were stored unchecked, and
// React happily renders a `javascript:` href rather than blocking it.

// Same check as ReplyThread's local isHttpUrl (kept there since that file has
// its own owner) — only http(s) URLs are ever rendered as external links.
export function isHttpUrl(value: string | null | undefined): value is string {
  if (!value) return false;
  try {
    const { protocol } = new URL(value);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

// The external href to render, or undefined (no link) for anything that
// isn't a plain http(s) URL.
export function safeExternalHref(value: string | null | undefined): string | undefined {
  return isHttpUrl(value) ? value : undefined;
}

// An in-app path that can safely be handed to a router <Link> or a
// navigation: must be root-relative, and not protocol-relative ("//evil.com")
// or its backslash variant ("/\evil.com"), which browsers normalize into a
// different origin. Whitespace/control characters are rejected outright since
// browsers strip some of them (tab/newline) while parsing, which can turn a
// harmless-looking "/\t/evil.com" back into "//evil.com".
export function isSafeAppPath(value: string | null | undefined): value is string {
  if (!value || !value.startsWith("/")) return false;
  if (value.startsWith("//") || value.includes("\\")) return false;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000- \u007F]/.test(value)) return false;
  try {
    return new URL(value, window.location.origin).origin === window.location.origin;
  } catch {
    return false;
  }
}

// Hostname of an external URL, for showing the viewer where a link actually
// goes before they follow it. Punycode (as URL.hostname returns it) on
// purpose: a lookalike internationalized domain shows as xn--… rather than
// passing for the real one.
export function externalHostname(value: string | null | undefined): string | null {
  if (!isHttpUrl(value)) return null;
  try {
    return new URL(value).hostname;
  } catch {
    return null;
  }
}
