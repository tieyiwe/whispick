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

async function scrapeOEmbed(url: string): Promise<{ title?: string; thumbnail?: string; authorName?: string; embedUrl?: string } | null> {
  const endpoints: Record<string, string> = {
    youtube: `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`,
    vimeo: `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(url)}`,
  };

  const platform = detectPlatform(url);
  const endpoint = platform ? endpoints[platform] : undefined;
  if (!endpoint) return null;

  try {
    const res = await fetch(endpoint, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const data = await res.json() as any;
    return {
      title: data.title,
      thumbnail: data.thumbnail_url,
      authorName: data.author_name,
    };
  } catch {
    return null;
  }
}

async function scrapeOpenGraph(url: string): Promise<{ title?: string; thumbnail?: string } | null> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(8000),
      headers: { "User-Agent": "WhispickBot/1.0" },
    });
    if (!res.ok) return null;
    const html = await res.text();

    const ogTitle = html.match(/<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']/i)?.[1]
      ?? html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:title["']/i)?.[1]
      ?? html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1];

    const ogImage = html.match(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i)?.[1]
      ?? html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:image["']/i)?.[1];

    return {
      title: ogTitle?.trim(),
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

  // Try oEmbed first, then OG scraping
  const oembed = await scrapeOEmbed(url);
  const og = oembed ? null : await scrapeOpenGraph(url);

  const meta = oembed ?? og;

  res.json({
    title: meta?.title ?? null,
    thumbnail: meta?.thumbnail ?? null,
    platform,
    embedUrl: buildEmbedUrl(url, platform),
    authorName: (oembed as any)?.authorName ?? null,
  });
});

export default router;
