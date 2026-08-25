import { describe, it, expect } from "vitest";
import request from "supertest";
import app from "../app";
import { looksLikeBareWallTitle, looksPrivate, truncateTitle } from "../lib/videoMeta";

describe("looksLikeBareWallTitle", () => {
  it("flags a bare platform-name title for facebook/instagram (a login-wall page's <title>, not a real post's)", () => {
    expect(looksLikeBareWallTitle("instagram", "Instagram")).toBe(true);
    expect(looksLikeBareWallTitle("instagram", "  instagram  ")).toBe(true);
    expect(looksLikeBareWallTitle("facebook", "Facebook")).toBe(true);
  });

  it("doesn't flag a real post title, even one that mentions the platform name", () => {
    expect(looksLikeBareWallTitle("instagram", "Instagram is testing a new feature")).toBe(false);
    expect(looksLikeBareWallTitle("facebook", "My trip to the mountains")).toBe(false);
  });

  it("only applies to facebook/instagram — a bare platform name elsewhere isn't suspicious", () => {
    expect(looksLikeBareWallTitle("youtube", "YouTube")).toBe(false);
    expect(looksLikeBareWallTitle(null, "Instagram")).toBe(false);
    expect(looksLikeBareWallTitle("instagram", undefined)).toBe(false);
  });
});

describe("looksPrivate", () => {
  it("catches known login-wall/unavailable phrasing", () => {
    expect(looksPrivate("Log into Facebook")).toBe(true);
    expect(looksPrivate("Video unavailable")).toBe(true);
    expect(looksPrivate("Login • Instagram")).toBe(true);
  });

  it("doesn't flag an ordinary title", () => {
    expect(looksPrivate("My vacation video")).toBe(false);
    expect(looksPrivate(undefined)).toBe(false);
  });
});

describe("truncateTitle", () => {
  // Regression: sending a Facebook video whisp failed with a raw
  // `videoTitle: too_big (max 300)` zod error surfaced straight to the
  // user, because Facebook posts have no real short "title" the way a
  // YouTube video does — resolveVideoMeta falls back to the post's
  // og:title (or og:description), which is routinely the full caption and
  // often runs well past 300 characters. This is the single choke point
  // (resolveVideoMeta's "ok" return) every scraped title passes through,
  // shared by the whisp composer, whisper groups, admin Suggestions
  // Library, and the AI content agents alike.
  it("leaves a short title untouched", () => {
    expect(truncateTitle("My vacation video")).toBe("My vacation video");
  });

  it("truncates a title over the 300-char videoTitle cap and adds an ellipsis", () => {
    const longCaption = "A".repeat(400);
    const result = truncateTitle(longCaption);
    expect(result.length).toBe(300);
    expect(result.endsWith("…")).toBe(true);
    expect(result.startsWith("A".repeat(299))).toBe(true);
  });

  it("leaves a title exactly at the cap untouched", () => {
    const exact = "B".repeat(300);
    expect(truncateTitle(exact)).toBe(exact);
  });
});

describe("POST /api/video/meta", () => {
  it("rejects URLs outside the video-platform allowlist (no server-side fetch of arbitrary hosts)", async () => {
    const res = await request(app).post("/api/video/meta").send({ url: "http://169.254.169.254/latest/meta-data/" });
    expect(res.status).toBe(400);
  });

  it("rejects a non-allowlisted host even when a known platform name appears in the query string", async () => {
    const res = await request(app).post("/api/video/meta").send({ url: "https://evil.example.com/?u=youtube.com" });
    expect(res.status).toBe(400);
  });

  it("rejects non-http(s) schemes", async () => {
    const res = await request(app).post("/api/video/meta").send({ url: "ftp://youtube.com/x" });
    expect(res.status).toBe(400);
  });
});
