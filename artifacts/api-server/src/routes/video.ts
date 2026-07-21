import { Router } from "express";
import { z } from "zod";

const router = Router();

// Hostname allowlist, checked against the parsed URL's actual host (not a
// substring match on the raw string) — otherwise "https://evil.com/?u=youtube.com"
// would pass a naive .includes() check. Anything outside this list is
// rejected before we ever make a server-side request to it, since this
// endpoint would otherwise be a straightforward SSRF: it lets an
// authenticated user make our server fetch an arbitrary URL (internal
// services, cloud metadata endpoints, etc.) and reflects part of the
// response back to them.
const ALLOWED_HOSTS: Record<string, string> = {
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

function detectPlatform(url: string): string | null {
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
function buildEmbedUrl(url: string, platform: string): string | null {
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

function looksPrivate(text: string | undefined): boolean {
  if (!text) return false;
  return PRIVATE_CONTENT_PATTERNS.some((pattern) => pattern.test(text));
}

type ScrapeResult = { status: number; title?: string; thumbnail?: string; authorName?: string };

async function scrapeOEmbed(url: string, platform: string | null): Promise<ScrapeResult | null> {
  const endpoints: Record<string, string> = {
    youtube: `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`,
    vimeo: `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(url)}`,
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

async function scrapeOpenGraph(url: string): Promise<ScrapeResult | null> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(8000),
      headers: { "User-Agent": "WhispickBot/1.0" },
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

// POST /api/video/meta
router.post("/meta", async (req, res): Promise<void> => {
  const schema = z.object({ url: z.string().url() });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid URL" });
    return;
  }

  const { url } = parsed.data;
  const parsedUrl = new URL(url);
  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    res.status(400).json({ error: "Only http/https URLs are supported" });
    return;
  }

  const platform = detectPlatform(url);
  if (!platform) {
    res.status(400).json({ error: "Unsupported video URL. Only YouTube, TikTok, Instagram, Facebook, Vimeo, and X/Twitter links are supported." });
    return;
  }

  // Try oEmbed first, then OG scraping — same order as before, but now every
  // path keeps the HTTP status so we can tell "private/restricted" apart
  // from "just couldn't scrape a title." A definitive block/not-found status
  // from oEmbed short-circuits immediately, without also scraping OG tags.
  const oembed = await scrapeOEmbed(url, platform);

  function blockResponse(status: number): { error: string; code: string } | null {
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

  if (oembed && (oembed.status === 401 || oembed.status === 403 || oembed.status === 404)) {
    const blocked = blockResponse(oembed.status);
    res.status(422).json(blocked);
    return;
  }

  const needsOg = !oembed || (!oembed.title && !oembed.thumbnail);
  const og = needsOg ? await scrapeOpenGraph(url) : null;
  const result = oembed?.title || oembed?.thumbnail ? oembed : og;

  const blocked = result ? blockResponse(result.status) : null;
  if (blocked) {
    res.status(422).json(blocked);
    return;
  }
  if (looksPrivate(result?.title)) {
    res.status(422).json({
      error: "This looks like a private or restricted video — the recipient won't be able to open it. Double-check its sharing settings, or use a public link instead.",
      code: "video_private",
    });
    return;
  }

  res.json({
    title: result?.title ?? null,
    thumbnail: result?.thumbnail ?? null,
    platform,
    embedUrl: buildEmbedUrl(url, platform),
    authorName: (oembed as any)?.authorName ?? null,
  });
});

export default router;
