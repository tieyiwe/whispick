// Shared third-party video URL resolution: hostname allowlist (SSRF guard),
// oEmbed/OpenGraph scraping, and private/restricted-content detection.
// Originally lived only in routes/video.ts; extracted so the admin
// Suggestions Library routes and the AI discovery agent (lib/suggestionAgent.ts)
// reuse the exact same allowlist and scraping logic instead of re-implementing
// (and potentially weakening) it. routes/video.ts is now a thin wrapper around
// resolveVideoMeta().

// Hostname allowlist, checked against the parsed URL's actual host (not a
// substring match on the raw string) — otherwise "https://evil.com/?u=youtube.com"
// would pass a naive .includes() check. Anything outside this list is
// rejected before we ever make a server-side request to it, since resolving
// a video URL is otherwise a straightforward SSRF: it lets a caller make our
// server fetch an arbitrary URL (internal services, cloud metadata
// endpoints, etc.) and reflects part of the response back.
export const ALLOWED_HOSTS: Record<string, string> = {
  "youtube.com": "youtube",
  "www.youtube.com": "youtube",
  "m.youtube.com": "youtube",
  "youtu.be": "youtube",
  "tiktok.com": "tiktok",
  "www.tiktok.com": "tiktok",
  "instagram.com": "instagram",
  "www.instagram.com": "instagram",
  "facebook.com": "facebook",
  "www.facebook.com": "facebook",
  "fb.watch": "facebook",
  "vimeo.com": "vimeo",
  "www.vimeo.com": "vimeo",
  "player.vimeo.com": "vimeo",
  "twitter.com": "twitter",
  "www.twitter.com": "twitter",
  "x.com": "twitter",
};

export function detectPlatform(url: string): string | null {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return ALLOWED_HOSTS[hostname] ?? null;
  } catch {
    return null;
  }
}

// Only YouTube and Vimeo expose an embeddable player with a JS API we can use
// to detect real watch progress — every other platform requires opening the
// original link, where we have no visibility into playback.
export function buildEmbedUrl(url: string, platform: string): string | null {
  if (platform === "youtube") {
    const match = url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|shorts\/|embed\/))([\w-]{11})/);
    return match ? `https://www.youtube.com/embed/${match[1]}?enablejsapi=1` : null;
  }
  if (platform === "vimeo") {
    const match = url.match(/vimeo\.com\/(?:video\/)?(\d+)/);
    return match ? `https://player.vimeo.com/video/${match[1]}` : null;
  }
  return null;
}

// Text that shows up in place of real content when a video/post is private,
// restricted to an audience the recipient won't be logged in as, age-gated,
// or deleted — checked against whatever oEmbed/OG scraping actually returned,
// since these platforms mostly respond 200 OK with a login-wall or
// "unavailable" page rather than a clean 4xx.
const PRIVATE_CONTENT_PATTERNS: RegExp[] = [
  /private video/i, // YouTube
  /video unavailable/i, // YouTube — deleted or region/age blocked
  /sign in to confirm your age/i, // YouTube age-gated (can't be watched without a signed-in account)
  /log ?in to (facebook|instagram)/i,
  /log into facebook/i,
  /you must log in/i,
  /login\s*[•·]\s*instagram/i,
  /this (content|page|post|video) (isn'?t|is not) available/i,
  /content isn'?t available (right now|at the moment)/i,
  /sorry, this content isn'?t available/i,
  /couldn'?t find (this|that) (account|page)/i,
];

export function looksPrivate(text: string | undefined): boolean {
  if (!text) return false;
  return PRIVATE_CONTENT_PATTERNS.some((pattern) => pattern.test(text));
}

export type ScrapeResult = { status: number; title?: string; thumbnail?: string; authorName?: string };

export async function scrapeOEmbed(url: string, platform: string | null): Promise<ScrapeResult | null> {
  const endpoints: Record<string, string> = {
    youtube: `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`,
    vimeo: `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(url)}`,
    // TikTok's oEmbed is public and unauthenticated, same as YouTube/Vimeo's.
    tiktok: `https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`,
    // Twitter/X's oEmbed still works unauthenticated for public tweets as of
    // this writing, but it's the least stable of these — X has tightened
    // access to everything else. Worth keeping since it's free when it
    // works; falls through to OpenGraph scraping below when it doesn't.
    twitter: `https://publish.twitter.com/oembed?url=${encodeURIComponent(url)}`,
    // Facebook and Instagram have no public, unauthenticated oEmbed
    // endpoint — Meta's real oEmbed (graph.facebook.com) requires an app
    // access token we don't have. They fall through to OpenGraph scraping
    // below, which works for these two as long as the request looks like a
    // known link-preview crawler (see scrapeOpenGraph's User-Agent choice).
  };

  const endpoint = platform ? endpoints[platform] : undefined;
  if (!endpoint) return null;

  try {
    const res = await fetch(endpoint, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return { status: res.status };
    const data = (await res.json()) as any;
    return {
      status: res.status,
      title: data.title,
      thumbnail: data.thumbnail_url,
      authorName: data.author_name,
    };
  } catch {
    return null;
  }
}

// Facebook/Instagram (and, to a lesser extent, other platforms) serve a
// stripped-down login-wall page — no OG tags — to requests that don't look
// like a recognized link-preview crawler, but serve the real page (full
// og:title/og:image) to ones they do recognize, since that's exactly how
// link previews work when you share an FB/IG link in iMessage, WhatsApp, or
// Slack. A generic custom bot name like the old "BlindWhisperBot/1.0" gets
// treated as an arbitrary unrecognized client and blocked. Use Meta's own
// crawler UA for its two properties, and a standard desktop browser UA
// everywhere else in this fallback path (TikTok/Twitter mostly succeed via
// oEmbed above and rarely reach this function, but a browser UA is a safer
// default for them too than an identifiable custom bot name).
function ogScrapeUserAgent(platform: string | null): string {
  if (platform === "facebook" || platform === "instagram") {
    return "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)";
  }
  return "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
}

export async function scrapeOpenGraph(url: string, platform: string | null = null): Promise<ScrapeResult | null> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(8000),
      headers: { "User-Agent": ogScrapeUserAgent(platform) },
    });
    if (!res.ok) return { status: res.status };
    const html = await res.text();

    const ogTitle = html.match(/<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']/i)?.[1]
      ?? html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:title["']/i)?.[1]
      ?? html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1];

    const ogImage = html.match(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i)?.[1]
      ?? html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:image["']/i)?.[1];

    // Facebook/Instagram often 200 the request and hand back the raw
    // <title>/description of a login-wall page instead of erroring, so the
    // description is worth checking too even when we don't return it.
    const ogDescription = html.match(/<meta[^>]*property=["']og:description["'][^>]*content=["']([^"']+)["']/i)?.[1];

    return {
      status: res.status,
      title: (ogTitle ?? ogDescription)?.trim(),
      thumbnail: ogImage?.trim(),
    };
  } catch {
    return null;
  }
}

function blockResponse(status: number): { error: string; code: "video_private" | "video_not_found" } | null {
  if (status === 401 || status === 403) {
    return {
      error: "This looks like a private or restricted video — the recipient won't be able to open it. Double-check its sharing settings, or use a public link instead.",
      code: "video_private",
    };
  }
  if (status === 404) {
    return {
      error: "This video couldn't be found — it may have been deleted or the link is broken.",
      code: "video_not_found",
    };
  }
  return null;
}

export type VideoMetaOutcome =
  | { kind: "invalid_url" }
  | { kind: "unsupported" }
  | { kind: "blocked"; error: string; code: "video_private" | "video_not_found" }
  | { kind: "ok"; title: string | null; thumbnail: string | null; platform: string; embedUrl: string | null; authorName: string | null };

// The full "given a URL, figure out if we can use it" flow — hostname
// allowlist check, oEmbed-then-OpenGraph scraping, and private/restricted
// detection — as one reusable function so every caller (the /video/meta
// route, the admin Suggestions Library, the AI discovery agent) gets
// identical SSRF protection and block detection rather than each
// reimplementing (and potentially drifting from) this logic.
export async function resolveVideoMeta(url: string): Promise<VideoMetaOutcome> {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    return { kind: "invalid_url" };
  }
  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    return { kind: "invalid_url" };
  }

  const platform = detectPlatform(url);
  if (!platform) {
    return { kind: "unsupported" };
  }

  // Try oEmbed first, then OG scraping — every path keeps the HTTP status so
  // we can tell "private/restricted" apart from "just couldn't scrape a
  // title." A definitive block/not-found status from oEmbed short-circuits
  // immediately, without also scraping OG tags.
  const oembed = await scrapeOEmbed(url, platform);

  if (oembed && (oembed.status === 401 || oembed.status === 403 || oembed.status === 404)) {
    const blocked = blockResponse(oembed.status);
    if (blocked) return { kind: "blocked", ...blocked };
  }

  const needsOg = !oembed || (!oembed.title && !oembed.thumbnail);
  const og = needsOg ? await scrapeOpenGraph(url, platform) : null;
  const result = oembed?.title || oembed?.thumbnail ? oembed : og;

  const blocked = result ? blockResponse(result.status) : null;
  if (blocked) return { kind: "blocked", ...blocked };

  if (looksPrivate(result?.title)) {
    return {
      kind: "blocked",
      error: "This looks like a private or restricted video — the recipient won't be able to open it. Double-check its sharing settings, or use a public link instead.",
      code: "video_private",
    };
  }

  return {
    kind: "ok",
    title: result?.title ?? null,
    thumbnail: result?.thumbnail ?? null,
    platform,
    embedUrl: buildEmbedUrl(url, platform),
    authorName: (oembed as any)?.authorName ?? null,
  };
}
