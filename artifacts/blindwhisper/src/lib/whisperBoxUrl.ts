// The canonical shareable Whisper Box URL — routes through the API
// server's GET /api/wb/:handle (artifacts/api-server/src/routes/
// whisperBoxLink.ts), which gives crawlers (iMessage/WhatsApp/Instagram/
// Twitter link previews) real Open Graph tags before redirecting a real
// browser straight into the SPA's /whisper-box/:handle page. Same pattern
// as the server's own /api/l/:token for whisp links — use this everywhere
// a Whisper Box link is copied, shared, or QR-encoded, so previews actually
// show something instead of the site's generic default.
export function whisperBoxShareUrl(handle: string): string {
  return `${window.location.origin}/api/wb/${encodeURIComponent(handle)}`;
}
