import { describe, it, expect } from "vitest";
import { buildEmbedUrl, embedUrlFor, detectPlatform } from "../lib/videoMeta";

// A whisp is supposed to open where it was sent. Every platform we can build
// an in-page player for gets one; the ones we can't are the only ones that
// should still bounce the recipient out to another app.
describe("buildEmbedUrl", () => {
  const cases: [string, string, string][] = [
    ["youtube", "https://www.youtube.com/watch?v=dQw4w9WgXcQ", "https://www.youtube.com/embed/dQw4w9WgXcQ?enablejsapi=1"],
    ["youtube", "https://youtu.be/dQw4w9WgXcQ", "https://www.youtube.com/embed/dQw4w9WgXcQ?enablejsapi=1"],
    ["vimeo", "https://vimeo.com/123456789", "https://player.vimeo.com/video/123456789"],
    ["tiktok", "https://www.tiktok.com/@someone/video/7123456789012345678", "https://www.tiktok.com/embed/v2/7123456789012345678"],
    ["instagram", "https://www.instagram.com/reel/CxYzAbC1234/", "https://www.instagram.com/p/CxYzAbC1234/embed/"],
    ["instagram", "https://www.instagram.com/p/CxYzAbC1234/", "https://www.instagram.com/p/CxYzAbC1234/embed/"],
  ];

  for (const [platform, url, expected] of cases) {
    it(`builds a player for ${platform}: ${url}`, () => {
      expect(buildEmbedUrl(url, platform)).toBe(expected);
    });
  }

  it("embeds a Facebook watch URL through the video plugin", () => {
    const embed = buildEmbedUrl("https://www.facebook.com/watch/?v=1234567890", "facebook");
    expect(embed).toBe(
      "https://www.facebook.com/plugins/video.php?href=https%3A%2F%2Fwww.facebook.com%2Fwatch%2F%3Fv%3D1234567890&show_text=false",
    );
  });

  it("embeds an fb.watch short link without needing to parse an id out of it", () => {
    // Passing the whole URL is what makes Facebook's several link shapes work
    // uniformly — this one carries no video id at all.
    expect(buildEmbedUrl("https://fb.watch/abc123XyZ/", "facebook")).toContain("plugins/video.php?href=https%3A%2F%2Ffb.watch");
  });

  // The Facebook embed is the one that interpolates a caller-supplied URL into
  // a URL of ours, so it's the one that has to be escaped.
  it("escapes the video URL so it can't append plugin parameters of its own", () => {
    const embed = buildEmbedUrl("https://www.facebook.com/watch/?v=1&show_text=true&evil=1", "facebook")!;
    // Everything after href= must be a single encoded value; the only literal
    // ampersand belongs to our own show_text parameter.
    const afterHref = embed.slice(embed.indexOf("href=") + "href=".length);
    expect(afterHref.split("&")).toHaveLength(2);
    expect(afterHref.endsWith("&show_text=false")).toBe(true);
    expect(embed).not.toContain("show_text=true");
  });

  it("returns null for X/Twitter, which has no iframe embed we'd load", () => {
    expect(buildEmbedUrl("https://x.com/someone/status/123", "twitter")).toBeNull();
  });

  it("returns null when the URL doesn't carry the id its embed needs", () => {
    expect(buildEmbedUrl("https://www.tiktok.com/@someone", "tiktok")).toBeNull();
    expect(buildEmbedUrl("https://www.instagram.com/someone/", "instagram")).toBeNull();
    expect(buildEmbedUrl("https://www.youtube.com/results?q=x", "youtube")).toBeNull();
  });
});

describe("embedUrlFor", () => {
  // Whisps written before a platform became embeddable have no stored embed
  // URL. Read paths derive it instead of needing a backfill.
  it("derives the platform when a stored row didn't record one", () => {
    expect(embedUrlFor("https://www.tiktok.com/@someone/video/7123456789012345678", null)).toBe(
      "https://www.tiktok.com/embed/v2/7123456789012345678",
    );
  });

  it("is null-safe for rows with no video URL", () => {
    expect(embedUrlFor(null, "tiktok")).toBeNull();
  });

  it("returns null for a host we don't recognise, rather than guessing", () => {
    expect(detectPlatform("https://evil.example/video/1")).toBeNull();
    expect(embedUrlFor("https://evil.example/video/1", null)).toBeNull();
  });
});
