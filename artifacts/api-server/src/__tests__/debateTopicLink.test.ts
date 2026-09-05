import { describe, it, expect } from "vitest";
import request from "supertest";
import app from "../app";
import { TEST_USER_HEADER } from "./setup";

function asUser(userId: string) {
  return { [TEST_USER_HEADER]: userId };
}

async function createTopic(userId: string, overrides: Record<string, unknown> = {}) {
  const res = await request(app)
    .post("/api/debate-topics")
    .set(asUser(userId))
    .send({ topicText: "Is honesty always the best policy?", ...overrides });
  return res.body as { id: string };
}

describe("GET /api/dt/:id", () => {
  it("redirects real browsers straight to the app", async () => {
    const topic = await createTopic("clerk_dt_link_user_1");
    const res = await request(app)
      .get(`/api/dt/${topic.id}`)
      .set("User-Agent", "Mozilla/5.0 (iPhone; CPU iPhone OS) AppleWebKit/605.1.15");

    expect(res.status).toBe(302);
    expect(res.headers.location).toContain(`/debate-topics/${topic.id}`);
  });

  it("serves a real Open Graph card to link-preview crawlers, with an encouraging no-account-needed description", async () => {
    const topic = await createTopic("clerk_dt_link_user_2", { topicText: "Is honesty always the best policy?" });
    const res = await request(app)
      .get(`/api/dt/${topic.id}`)
      .set("User-Agent", "WhatsApp/2.23.20 A");

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.text).toContain("Is honesty always the best policy?");
    expect(res.text).toContain("No account needed");
    expect(res.text).toContain(`/debate-topics/${topic.id}`);
    expect(res.text).toContain('property="og:site_name" content="Blind Whisper"');
    expect(res.text).toContain('name="twitter:card" content="summary_large_image"');
  });

  it("redirects unknown ids rather than erroring", async () => {
    const res = await request(app).get("/api/dt/does-not-exist").set("User-Agent", "WhatsApp/2.23.20 A");
    expect(res.status).toBe(302);
  });

  it("stops unfurling a retracted topic's text", async () => {
    const topic = await createTopic("clerk_dt_link_user_3", { topicText: "A topic about to be retracted" });
    await request(app).delete(`/api/debate-topics/${topic.id}`).set(asUser("clerk_dt_link_user_3"));

    const res = await request(app)
      .get(`/api/dt/${topic.id}`)
      .set("User-Agent", "WhatsApp/2.23.20 A");

    expect(res.status).toBe(302);
    expect(res.text).not.toContain("A topic about to be retracted");
  });
});
