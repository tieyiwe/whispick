import { describe, it, expect, vi, afterEach } from "vitest";
import request from "supertest";
import app from "../app";

function htmlResponse(status: number, html: string): Response {
  return new Response(html, { status, headers: { "content-type": "text/html" } });
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("POST /api/video/meta — private/restricted content detection", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("flags a YouTube video as private when oEmbed returns 401", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: any) => {
        const url = String(input);
        if (url.includes("youtube.com/oembed")) return jsonResponse(401, {});
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );

    const res = await request(app).post("/api/video/meta").send({ url: "https://youtu.be/abc12345678" });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe("video_private");
    vi.unstubAllGlobals();
  });

  it("flags a YouTube video as not found when oEmbed returns 404", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: any) => {
        const url = String(input);
        if (url.includes("youtube.com/oembed")) return jsonResponse(404, {});
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );

    const res = await request(app).post("/api/video/meta").send({ url: "https://youtu.be/abc12345678" });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe("video_not_found");
    vi.unstubAllGlobals();
  });

  it("passes through a normal accessible YouTube video", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: any) => {
        const url = String(input);
        if (url.includes("youtube.com/oembed")) {
          return jsonResponse(200, { title: "A great video", thumbnail_url: "https://img.example/x.jpg", author_name: "Someone" });
        }
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );

    const res = await request(app).post("/api/video/meta").send({ url: "https://youtu.be/abc12345678" });
    expect(res.status).toBe(200);
    expect(res.body.title).toBe("A great video");
    expect(res.body.platform).toBe("youtube");
    vi.unstubAllGlobals();
  });

  it("flags a Facebook post as private when the scraped page is a login wall", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: any) => {
        const url = String(input);
        if (url.includes("facebook.com")) {
          return htmlResponse(200, `<html><head><title>Log into Facebook</title></head></html>`);
        }
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );

    const res = await request(app).post("/api/video/meta").send({ url: "https://www.facebook.com/someone/videos/12345" });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe("video_private");
    vi.unstubAllGlobals();
  });

  it("flags a deleted/unavailable YouTube video detected via OG scrape content", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: any) => {
        const url = String(input);
        if (url.includes("youtube.com/oembed")) return jsonResponse(200, {});
        if (url.includes("youtu.be")) return htmlResponse(200, `<html><head><title>Private video</title></head></html>`);
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );

    const res = await request(app).post("/api/video/meta").send({ url: "https://youtu.be/abc12345678" });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe("video_private");
    vi.unstubAllGlobals();
  });

  it("passes through a normal accessible Facebook post", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: any) => {
        const url = String(input);
        if (url.includes("facebook.com")) {
          return htmlResponse(200, `<html><head><meta property="og:title" content="A public video"></head></html>`);
        }
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );

    const res = await request(app).post("/api/video/meta").send({ url: "https://www.facebook.com/someone/videos/12345" });
    expect(res.status).toBe(200);
    expect(res.body.title).toBe("A public video");
    vi.unstubAllGlobals();
  });
});
