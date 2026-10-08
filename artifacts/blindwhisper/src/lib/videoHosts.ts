import { externalHostname } from "@/lib/safeHref";

// Mirrors api-server lib/videoMeta.ts's ALLOWED_HOSTS: the video platforms a
// link can be opened on without an "are you sure" step. Anything else a
// sender pasted (platform "other"/unknown) could be a tracking or phishing
// page aimed at the recipient, so the player shows its hostname first.
const KNOWN_VIDEO_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "youtu.be",
  "tiktok.com",
  "www.tiktok.com",
  "instagram.com",
  "www.instagram.com",
  "facebook.com",
  "www.facebook.com",
  "fb.watch",
  "vimeo.com",
  "www.vimeo.com",
  "player.vimeo.com",
  "twitter.com",
  "www.twitter.com",
  "x.com",
]);

// Exactly the hosts videoMeta.ts's buildEmbedUrl produces. The embed URL is
// derived server-side today, but it's rendered as an <iframe> in the viewer's
// session, so the client refuses anything else (old rows, a future server
// bug) rather than trusting it blindly.
const EMBED_HOSTS = new Set([
  "www.youtube.com",
  "player.vimeo.com",
  "www.tiktok.com",
  "www.instagram.com",
  "www.facebook.com",
]);

export function isKnownVideoUrl(url: string | null | undefined): boolean {
  const host = externalHostname(url);
  return !!host && KNOWN_VIDEO_HOSTS.has(host.toLowerCase());
}

export function isAllowedEmbedUrl(url: string | null | undefined): url is string {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && EMBED_HOSTS.has(parsed.hostname.toLowerCase());
  } catch {
    return false;
  }
}
