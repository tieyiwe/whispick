// The canonical shareable Whisper Box URL — routes through the API
// server's GET /wb/:handle (artifacts/api-server/src/routes/
// whisperBoxLink.ts, mounted at the bare "/wb" prefix in app.ts — see its
// own comment), which gives crawlers (iMessage/WhatsApp/Instagram/Twitter
// link previews) real Open Graph tags before redirecting a real browser
// straight into the SPA's /whisper-box/:handle page. Deliberately NOT
// under "/api" — a shared link should read as blindwhisper.com/wb/handle,
// not blindwhisper.com/api/wb/handle. Use this everywhere a Whisper Box
// link is copied, shared, or QR-encoded, so previews actually show
// something instead of the site's generic default.
export function whisperBoxShareUrl(handle: string): string {
  return `${window.location.origin}/wb/${encodeURIComponent(handle)}`;
}
