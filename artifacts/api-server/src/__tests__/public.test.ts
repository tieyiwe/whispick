import { describe, it, expect } from "vitest";
import request from "supertest";
import app from "../app";
import { TEST_USER_HEADER } from "./setup";

const USER_A = "clerk_user_public";

async function createWhisp(overrides: Record<string, unknown> = {}) {
  const res = await request(app)
    .post("/api/whisps")
    .set(TEST_USER_HEADER, USER_A)
    .send({ videoUrl: "https://youtu.be/x", deliveryMethod: "circle_drop", ...overrides });
  return res.body as { id: string; publicToken: string };
}

describe("GET /api/public/w/:token", () => {
  it("returns 404 for an unknown token", async () => {
    const res = await request(app).get("/api/public/w/does-not-exist");
    expect(res.status).toBe(404);
  });

  it("returns only public-safe fields for a known token", async () => {
    const whisp = await createWhisp({ anonymousNote: "be well", senderAlias: "A friend" });

    const res = await request(app).get(`/api/public/w/${whisp.publicToken}`);
    expect(res.status).toBe(200);
    expect(res.body.anonymousNote).toBe("be well");
    expect(res.body).not.toHaveProperty("senderId");
  });

  it("includes the reply thread so the recipient can see prior messages, not just send a one-shot reply", async () => {
    const whisp = await createWhisp();

    await request(app).post(`/api/public/w/${whisp.publicToken}/reply`).send({ replyText: "thank you" });
    await request(app)
      .post(`/api/whisps/${whisp.id}/replies`)
      .set(TEST_USER_HEADER, USER_A)
      .send({ replyText: "of course" });

    const res = await request(app).get(`/api/public/w/${whisp.publicToken}`);
    expect(res.status).toBe(200);
    expect(res.body.replies).toHaveLength(2);
    expect(res.body.replies[0].fromRecipient).toBe(true);
    expect(res.body.replies[1].fromRecipient).toBe(false);
  });
});

describe("POST /api/public/w/:token/track", () => {
  it("marks the whisp opened and watched based on event type", async () => {
    const whisp = await createWhisp();

    const opened = await request(app).post(`/api/public/w/${whisp.publicToken}/track`).send({ eventType: "opened" });
    expect(opened.status).toBe(200);

    const watched = await request(app)
      .post(`/api/public/w/${whisp.publicToken}/track`)
      .send({ eventType: "watched_complete" });
    expect(watched.status).toBe(200);

    const detail = await request(app).get(`/api/whisps/${whisp.id}`).set(TEST_USER_HEADER, USER_A);
    expect(detail.body.whisp.status).toBe("watched");
    expect(detail.body.whisp.openedAt).not.toBeNull();
    expect(detail.body.whisp.watchedAt).not.toBeNull();
  });
});

describe("POST /api/public/w/:token/reply", () => {
  it("records an anonymous reply and marks the whisp replied", async () => {
    const whisp = await createWhisp();

    const res = await request(app).post(`/api/public/w/${whisp.publicToken}/reply`).send({ replyText: "thank you" });
    expect(res.status).toBe(201);
    expect(res.body.fromRecipient).toBe(true);

    const detail = await request(app).get(`/api/whisps/${whisp.id}`).set(TEST_USER_HEADER, USER_A);
    expect(detail.body.whisp.status).toBe("replied");
    expect(detail.body.replies).toHaveLength(1);
  });

  it("keeps status as replied even if watched_complete fires afterwards", async () => {
    const whisp = await createWhisp();

    await request(app).post(`/api/public/w/${whisp.publicToken}/reply`).send({ replyText: "thanks!" });
    const watched = await request(app)
      .post(`/api/public/w/${whisp.publicToken}/track`)
      .send({ eventType: "watched_complete" });
    expect(watched.status).toBe(200);

    const detail = await request(app).get(`/api/whisps/${whisp.id}`).set(TEST_USER_HEADER, USER_A);
    expect(detail.body.whisp.status).toBe("replied");
    expect(detail.body.whisp.watchedAt).not.toBeNull();
  });

  it("accepts a whisp-back video reply with no text", async () => {
    const whisp = await createWhisp();

    const res = await request(app).post(`/api/public/w/${whisp.publicToken}/reply`).send({
      videoUrl: "https://youtu.be/reply",
      videoTitle: "A video back",
      videoPlatform: "youtube",
    });
    expect(res.status).toBe(201);
    expect(res.body.videoUrl).toBe("https://youtu.be/reply");
    expect(res.body.replyText).toBe("");

    const detail = await request(app).get(`/api/whisps/${whisp.id}`).set(TEST_USER_HEADER, USER_A);
    expect(detail.body.replies[0].videoUrl).toBe("https://youtu.be/reply");
  });

  it("rejects a reply with neither text nor a video", async () => {
    const whisp = await createWhisp();

    const res = await request(app).post(`/api/public/w/${whisp.publicToken}/reply`).send({});
    expect(res.status).toBe(400);
  });
});
