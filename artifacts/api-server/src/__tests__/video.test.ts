import { describe, it, expect } from "vitest";
import request from "supertest";
import app from "../app";
import { looksLikeBareWallTitle, looksPrivate } from "../lib/videoMeta";

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
