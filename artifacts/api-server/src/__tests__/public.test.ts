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

  // The Sender's "you got a reply" notification is deliberately deferred
  // (see lib/replyNotificationScheduler.ts) so an instant phone-buzz can't
  // reveal the Sender's identity if they're physically with the Recipient.
  // We can't intercept the real outbound email/push here (this codebase
  // doesn't mock those network calls elsewhere either) — instead we assert
  // the scheduling state the route is responsible for: nothing has fired
  // yet, and it's queued for one of the three allowed delays.
  it("schedules the sender notification for later instead of firing immediately", async () => {
    const whisp = await createWhisp();
    const before = Date.now();

    const res = await request(app).post(`/api/public/w/${whisp.publicToken}/reply`).send({ replyText: "thank you" });
    expect(res.status).toBe(201);
    expect(res.body.senderNotifiedAt).toBeNull();
    expect(res.body.notifySenderAt).not.toBeNull();

    const notifyAt = new Date(res.body.notifySenderAt).getTime();
    const deltaMinutes = Math.round((notifyAt - before) / 60_000);
    expect([3, 5, 9]).toContain(deltaMinutes);
  });

  // Security: a reply's thumbnail/embed are auto-loaded in the SENDER's
  // browser, so an attacker-controlled URL there would silently leak the
  // sender's IP/geo to the recipient (a break of the core anonymity model),
  // and a javascript: URL would be stored XSS. Both are prevented by
  // validating videoUrl as http(s) and deriving the rest server-side.
  it("rejects a javascript: video URL in a reply", async () => {
    const whisp = await createWhisp();

    const res = await request(app)
      .post(`/api/public/w/${whisp.publicToken}/reply`)
      .send({ videoUrl: "javascript:alert(document.cookie)" });
    expect(res.status).toBe(400);
  });

  it("ignores a client-supplied reply thumbnail/embed and derives them server-side (anti-deanonymization)", async () => {
    const whisp = await createWhisp();

    const res = await request(app).post(`/api/public/w/${whisp.publicToken}/reply`).send({
      videoUrl: "https://youtu.be/dQw4w9WgXcQ",
      videoThumbnail: "https://attacker.example/track.gif?whisp=leak",
      videoEmbedUrl: "https://attacker.example/phish",
      videoPlatform: "youtube",
    });
    expect(res.status).toBe(201);
    // The attacker URLs never made it into storage...
    expect(res.body.videoThumbnail).not.toContain("attacker.example");
    expect(res.body.videoEmbedUrl ?? "").not.toContain("attacker.example");
    // ...they were replaced by the server-derived, platform-hosted values.
    expect(res.body.videoThumbnail).toBe("https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg");
    expect(res.body.videoEmbedUrl).toBe("https://www.youtube.com/embed/dQw4w9WgXcQ?enablejsapi=1");
  });

  it("drops a non-YouTube reply thumbnail rather than trusting the client (no attacker host reaches the sender's browser)", async () => {
    const whisp = await createWhisp();

    const res = await request(app).post(`/api/public/w/${whisp.publicToken}/reply`).send({
      videoUrl: "https://www.tiktok.com/@a/video/123",
      videoThumbnail: "https://attacker.example/track.gif",
    });
    expect(res.status).toBe(201);
    expect(res.body.videoPlatform).toBe("tiktok");
    // No deterministic safe thumbnail for TikTok, so it's null — never the
    // attacker-supplied one.
    expect(res.body.videoThumbnail).toBeNull();
  });
});

describe("anonymous recipient reply cap", () => {
  // Default free allowance is 3 (lib/plans.ts recipientFreeReplies).
  it("blocks an anonymous recipient once they've used their free replies", async () => {
    const whisp = await createWhisp();

    for (let i = 0; i < 3; i++) {
      const ok = await request(app).post(`/api/public/w/${whisp.publicToken}/reply`).send({ replyText: `reply ${i}` });
      expect(ok.status).toBe(201);
    }

    const blocked = await request(app).post(`/api/public/w/${whisp.publicToken}/reply`).send({ replyText: "one too many" });
    expect(blocked.status).toBe(403);
    expect(blocked.body.code).toBe("reply_limit_reached");
  });

  it("reports how many anonymous replies are left, and 0 once exhausted", async () => {
    const whisp = await createWhisp();

    const fresh = await request(app).get(`/api/public/w/${whisp.publicToken}`);
    expect(fresh.body.recipientRepliesRemaining).toBe(3);

    await request(app).post(`/api/public/w/${whisp.publicToken}/reply`).send({ replyText: "one" });
    const afterOne = await request(app).get(`/api/public/w/${whisp.publicToken}`);
    expect(afterOne.body.recipientRepliesRemaining).toBe(2);

    await request(app).post(`/api/public/w/${whisp.publicToken}/reply`).send({ replyText: "two" });
    await request(app).post(`/api/public/w/${whisp.publicToken}/reply`).send({ replyText: "three" });
    const exhausted = await request(app).get(`/api/public/w/${whisp.publicToken}`);
    expect(exhausted.body.recipientRepliesRemaining).toBe(0);
  });

  // The sender's own follow-ups go through the authenticated route and are
  // fromRecipient:false, so they must not consume the recipient's allowance.
  it("doesn't count the sender's follow-ups against the recipient's allowance", async () => {
    const whisp = await createWhisp();

    for (let i = 0; i < 3; i++) {
      await request(app)
        .post(`/api/whisps/${whisp.id}/replies`)
        .set(TEST_USER_HEADER, USER_A)
        .send({ replyText: `sender follow-up ${i}` });
    }

    const stillAllowed = await request(app).post(`/api/public/w/${whisp.publicToken}/reply`).send({ replyText: "mine" });
    expect(stillAllowed.status).toBe(201);
  });
});
