import { logger } from "./logger";

function extractYoutubeVideoId(url: string): string | null {
  const match = url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|shorts\/|embed\/))([\w-]{11})/);
  return match ? match[1] : null;
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)));
}

// Best-effort scrape of YouTube's auto-generated caption track, the same
// technique unofficial "youtube transcript" libraries use: the watch page's
// inline player-response JSON lists caption tracks with a direct URL to their
// timed-text XML, no API key required. This is intentionally tolerant of
// failure (no captions, YouTube markup changes, network hiccups) since it's
// only ever a supporting signal for video categorization, not a feature a
// user is blocked on — every path returns null rather than throwing.
export async function fetchYoutubeTranscript(videoUrl: string): Promise<string | null> {
  const videoId = extractYoutubeVideoId(videoUrl);
  if (!videoId) return null;

  try {
    const pageRes = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
      signal: AbortSignal.timeout(8000),
      headers: { "User-Agent": "Mozilla/5.0 (compatible; WhispickBot/1.0)" },
    });
    if (!pageRes.ok) return null;
    const html = await pageRes.text();

    const tracksMatch = html.match(/"captionTracks":(\[.*?\])(?=,")/);
    if (!tracksMatch) return null;

    let tracks: Array<{ baseUrl: string; languageCode: string }>;
    try {
      tracks = JSON.parse(tracksMatch[1].replace(/\\u0026/g, "&"));
    } catch {
      return null;
    }
    if (!tracks.length) return null;

    const track = tracks.find((t) => t.languageCode?.startsWith("en")) ?? tracks[0]!;
    const captionRes = await fetch(track.baseUrl, { signal: AbortSignal.timeout(8000) });
    if (!captionRes.ok) return null;
    const xml = await captionRes.text();

    const text = [...xml.matchAll(/<text[^>]*>([^<]*)<\/text>/g)]
      .map((m) => decodeHtmlEntities(m[1] ?? ""))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();

    return text ? text.slice(0, 6000) : null;
  } catch (err) {
    logger.debug({ err, videoId }, "YouTube transcript fetch failed");
    return null;
  }
}

// Only YouTube exposes a free, keyless way to fetch captions. Every other
// platform (TikTok, Instagram, Facebook, Vimeo, X) has no equivalent without
// a paid API or heavier scraping, so categorization for those falls back to
// title-only signal.
export async function fetchTranscript(videoUrl: string, platform: string | null | undefined): Promise<string | null> {
  if (platform === "youtube") return fetchYoutubeTranscript(videoUrl);
  return null;
}
