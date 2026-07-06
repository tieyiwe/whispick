import { Router } from "express";
import { z } from "zod";

const router = Router();

function detectPlatform(url: string): string {
  if (url.includes("youtube.com") || url.includes("youtu.be")) return "youtube";
  if (url.includes("tiktok.com")) return "tiktok";
  if (url.includes("instagram.com")) return "instagram";
  if (url.includes("facebook.com") || url.includes("fb.com") || url.includes("fb.watch")) return "facebook";
  if (url.includes("vimeo.com")) return "vimeo";
  if (url.includes("twitter.com") || url.includes("x.com")) return "twitter";
  return "other";
}

async function scrapeOEmbed(url: string): Promise<{ title?: string; thumbnail?: string; authorName?: string; embedUrl?: string } | null> {
  const endpoints: Record<string, string> = {
    youtube: `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`,
    vimeo: `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(url)}`,
  };

  const platform = detectPlatform(url);
  const endpoint = endpoints[platform];
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
      headers: { "User-Agent": "WhisprBot/1.0" },
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
  const platform = detectPlatform(url);

  // Try oEmbed first, then OG scraping
  const oembed = await scrapeOEmbed(url);
  const og = oembed ? null : await scrapeOpenGraph(url);

  const meta = oembed ?? og;

  res.json({
    title: meta?.title ?? null,
    thumbnail: meta?.thumbnail ?? null,
    platform,
    embedUrl: null,
    authorName: (oembed as any)?.authorName ?? null,
  });
});

export default router;
