import { describe, it, expect } from "vitest";
import request from "supertest";
import app from "../app";
import { TEST_USER_HEADER } from "./setup";

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

  it("redirects unknown tokens rather than erroring", async () => {
    const res = await request(app).get("/api/l/does-not-exist");
    expect(res.status).toBe(302);
  });
});
