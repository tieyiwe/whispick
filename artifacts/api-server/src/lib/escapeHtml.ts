// Escapes the five HTML-significant characters so a user-controlled (or
// third-party-scraped, e.g. an og:title from an arbitrary video page) string
// can't inject markup when interpolated into an HTML string we build
// server-side — outbound email bodies (lib/email.ts) and the crawler OG page
// (routes/link.ts). React handles this automatically for rendered content;
// these are the hand-built HTML strings that don't go through React.
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
