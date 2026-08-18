import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import app from "../app";
import { db, whispRepliesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
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

    // Asserted from the DB, NOT the response: notifySenderAt/senderNotifiedAt
    // must never be returned to the recipient (see the test below) — telling
    // them exactly when the sender's phone will buzz defeats the very delay
    // this schedules.
    const row = await db
      .select()
      .from(whispRepliesTable)
      .where(eq(whispRepliesTable.id, res.body.id))
      .then((r) => r[0]);
    expect(row?.senderNotifiedAt).toBeNull();
    expect(row?.notifySenderAt).not.toBeNull();

    const notifyAt = new Date(row!.notifySenderAt!).getTime();
    const deltaMinutes = Math.round((notifyAt - before) / 60_000);
    expect([3, 5, 9]).toContain(deltaMinutes);
  });

  // The 3/5/9-minute random delay exists so a sender who is physically with
  // the recipient isn't given away by their phone buzzing the instant the
  // recipient hits send. Handing the recipient notifySenderAt would publish
  // that countdown to exactly the party it hides from.
  it("never exposes the sender-notification schedule to the recipient", async () => {
    const whisp = await createWhisp();

    const created = await request(app).post(`/api/public/w/${whisp.publicToken}/reply`).send({ replyText: "hi" });
    expect(created.status).toBe(201);
    expect(created.body).not.toHaveProperty("notifySenderAt");
    expect(created.body).not.toHaveProperty("senderNotifiedAt");

    const page = await request(app).get(`/api/public/w/${whisp.publicToken}`);
    expect(page.status).toBe(200);
    for (const reply of page.body.replies) {
      expect(reply).not.toHaveProperty("notifySenderAt");
      expect(reply).not.toHaveProperty("senderNotifiedAt");
    }
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

// Per-message replying: the client sends the id of the message being
// answered so the thread can quote it. That id is attacker-controlled (this
// route is unauthenticated), so the only thing standing between it and a
// cross-thread leak is the same-whisp check.
describe("threaded replies (parentReplyId)", () => {
  it("keeps the parent reference when it points at a message on the same whisp", async () => {
    const whisp = await createWhisp();
    const first = await request(app)
      .post(`/api/whisps/${whisp.id}/replies`)
      .set(TEST_USER_HEADER, USER_A)
      .send({ replyText: "how are you?" });

    const answer = await request(app)
      .post(`/api/public/w/${whisp.publicToken}/reply`)
      .send({ replyText: "better now", parentReplyId: first.body.id });

    expect(answer.status).toBe(201);
    expect(answer.body.parentReplyId).toBe(first.body.id);

    const page = await request(app).get(`/api/public/w/${whisp.publicToken}`);
    expect(page.body.replies.find((r: any) => r.id === answer.body.id).parentReplyId).toBe(first.body.id);
  });

  it("drops a parent id belonging to a different whisp instead of quoting across threads", async () => {
    const mine = await createWhisp();
    const theirs = await createWhisp();
    const foreign = await request(app)
      .post(`/api/public/w/${theirs.publicToken}/reply`)
      .send({ replyText: "a secret from another thread" });

    const res = await request(app)
      .post(`/api/public/w/${mine.publicToken}/reply`)
      .send({ replyText: "probing", parentReplyId: foreign.body.id });

    // Accepted as an ordinary message — the reference is silently dropped
    // rather than 400'd, since a stale id (parent deleted while typing) is a
    // normal race, not an attack worth surfacing to the user.
    expect(res.status).toBe(201);
    expect(res.body.parentReplyId).toBeNull();
  });

  it("drops a parent id that doesn't exist at all", async () => {
    const whisp = await createWhisp();

    const res = await request(app)
      .post(`/api/public/w/${whisp.publicToken}/reply`)
      .send({ replyText: "hello", parentReplyId: "no-such-reply" });

    expect(res.status).toBe(201);
    expect(res.body.parentReplyId).toBeNull();
  });

  it("applies the same-whisp rule to the sender's own replies", async () => {
    const mine = await createWhisp();
    const theirs = await createWhisp();
    const foreign = await request(app)
      .post(`/api/public/w/${theirs.publicToken}/reply`)
      .send({ replyText: "elsewhere" });

    const res = await request(app)
      .post(`/api/whisps/${mine.id}/replies`)
      .set(TEST_USER_HEADER, USER_A)
      .send({ replyText: "probing", parentReplyId: foreign.body.id });

    expect(res.status).toBe(201);
    expect(res.body.parentReplyId).toBeNull();
  });
});

describe("anonymous recipient reply cap", () => {
  // The cap ships OFF by default until billing exists (see plans.ts's
  // TODO(payment)), so these pin it on explicitly rather than relying on the
  // default — that keeps the enforcement logic under test either way, and
  // means flipping the default back doesn't quietly change what's covered.
  // recipientFreeReplies() reads the env var per call, so setting it here is
  // enough; no module reload needed.
  beforeAll(() => {
    process.env.RECIPIENT_FREE_REPLIES = "3";
  });
  afterAll(() => {
    delete process.env.RECIPIENT_FREE_REPLIES;
  });

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
