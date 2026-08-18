import { describe, it, expect } from "vitest";
import request from "supertest";
import app from "../app";
import { TEST_USER_HEADER } from "./setup";
import { db, whispsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const USER_A = "clerk_link_user";

async function createWhisp() {
  const res = await request(app)
    .post("/api/whisps")
    .set(TEST_USER_HEADER, USER_A)
    .send({
      videoUrl: "https://youtu.be/dQw4w9WgXcQ",
      videoTitle: "A Really Good Video",
      // Deliberately an attacker-style off-platform thumbnail: the server
      // derives the real thumbnail from the URL and must IGNORE this, so it
      // should never reach the OG card (see the assertion below).
      videoThumbnail: "https://example.com/thumb.jpg",
      deliveryMethod: "circle_drop",
    });
  return res.body as { publicToken: string };
}

describe("GET /api/l/:token", () => {
  it("redirects real browsers straight to the app", async () => {
    const whisp = await createWhisp();
    const res = await request(app)
      .get(`/api/l/${whisp.publicToken}`)
      .set("User-Agent", "Mozilla/5.0 (iPhone; CPU iPhone OS) AppleWebKit/605.1.15");

    expect(res.status).toBe(302);
    expect(res.headers.location).toContain(`/w/${whisp.publicToken}`);
  });

  it("serves a real Open Graph card to link-preview crawlers", async () => {
    const whisp = await createWhisp();
    const res = await request(app)
      .get(`/api/l/${whisp.publicToken}`)
      .set("User-Agent", "WhatsApp/2.23.20 A");

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.text).toContain("A Really Good Video");
    // The server-derived YouTube thumbnail, not the client-supplied one.
    expect(res.text).toContain("https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg");
    expect(res.text).not.toContain("https://example.com/thumb.jpg");
    expect(res.text).toContain(`/w/${whisp.publicToken}`);
  });

  it("gives an uploaded video's thumbnail an absolute URL", async () => {
    // An upload's thumbnail is stored site-relative, because no absolute host
    // is known when the whisp is written. Passed through as-is it is not a
    // valid og:image, and every whisp made from an upload unfurled with no
    // picture at all.
    const whisp = await createWhisp();
    await db
      .update(whispsTable)
      .set({ videoThumbnail: `/api/public/w/${whisp.publicToken}/media/thumbnail` })
      .where(eq(whispsTable.publicToken, whisp.publicToken));

    const res = await request(app)
      .get(`/api/l/${whisp.publicToken}`)
      .set("User-Agent", "WhatsApp/2.23.20 A");

    const ogImage = res.text.match(/<meta property="og:image" content="([^"]+)"/)?.[1];
    expect(ogImage).toBeDefined();
    expect(() => new URL(ogImage!)).not.toThrow();
    expect(ogImage).toContain(`/api/public/w/${whisp.publicToken}/media/thumbnail`);
  });

  it("names the site and its content type, so an unfurl isn't a bare link", async () => {
    const whisp = await createWhisp();
    const res = await request(app)
      .get(`/api/l/${whisp.publicToken}`)
      .set("User-Agent", "WhatsApp/2.23.20 A");

    expect(res.text).toContain('property="og:site_name" content="Blind Whisper"');
    expect(res.text).toContain('name="twitter:card" content="summary_large_image"');
  });

  it("recognises the crawlers that were previously falling through to a redirect", async () => {
    const whisp = await createWhisp();
    // A crawler that isn't recognised gets a 302 and unfurls nothing, so the
    // pattern is the whole feature for these clients.
    for (const ua of ["Mastodon/4.2", "Iframely/1.3", "Pinterest/0.2", "bingbot/2.0"]) {
      const res = await request(app).get(`/api/l/${whisp.publicToken}`).set("User-Agent", ua);
      expect(res.status, `${ua} should get the OG card`).toBe(200);
    }
  });

  it("redirects unknown tokens rather than erroring", async () => {
    const res = await request(app).get("/api/l/does-not-exist");
    expect(res.status).toBe(302);
  });
});
