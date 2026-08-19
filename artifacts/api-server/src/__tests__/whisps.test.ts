import { describe, it, expect } from "vitest";
import request from "supertest";
import app from "../app";
import { db, usersTable, whispsTable, whispRepliesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { TEST_USER_HEADER } from "./setup";

const USER_A = "clerk_user_a";
const USER_B = "clerk_user_b";

function asUser(userId: string) {
  return { [TEST_USER_HEADER]: userId };
}

async function getUser(clerkId: string) {
  return db.select().from(usersTable).where(eq(usersTable.clerkId, clerkId)).then((r) => r[0]);
}

describe("POST /api/whisps", () => {
  it("rejects unauthenticated requests", async () => {
    const res = await request(app).post("/api/whisps").send({ videoUrl: "https://youtu.be/x", deliveryMethod: "whisper_link" });
    expect(res.status).toBe(401);
  });

  it("requires a delivery channel for whisper_link", async () => {
    const res = await request(app)
      .post("/api/whisps")
      .set(asUser(USER_A))
      .send({ videoUrl: "https://youtu.be/x", deliveryMethod: "whisper_link" });
    expect(res.status).toBe(400);
  });

  it("requires a recipient email when the channel is email", async () => {
    const res = await request(app)
      .post("/api/whisps")
      .set(asUser(USER_A))
      .send({ videoUrl: "https://youtu.be/x", deliveryMethod: "whisper_link", whisperChannel: "email" });
    expect(res.status).toBe(400);
  });

  it("requires a recipient phone when the channel is sms or whatsapp", async () => {
    const res = await request(app)
      .post("/api/whisps")
      .set(asUser(USER_A))
      .send({ videoUrl: "https://youtu.be/x", deliveryMethod: "whisper_link", whisperChannel: "whatsapp" });
    expect(res.status).toBe(400);
  });

  it("sends a whisper_link whisp via email and increments the sender's usage counter", async () => {
    const res = await request(app)
      .post("/api/whisps")
      .set(asUser(USER_A))
      .send({
        videoUrl: "https://youtu.be/x",
        deliveryMethod: "whisper_link",
        whisperChannel: "email",
        recipientEmail: "friend@example.com",
      });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe("delivered");
    expect(res.body.deliveredAt).not.toBeNull();
    expect(res.body.whisperChannel).toBe("email");

    const user = await getUser(USER_A);
    expect(user.whisperLinksUsed).toBe(1);
  });

  it("sends a whisper_link whisp via SMS using the recipient phone number", async () => {
    const res = await request(app)
      .post("/api/whisps")
      .set(asUser(USER_A))
      .send({
        videoUrl: "https://youtu.be/x",
        deliveryMethod: "whisper_link",
        whisperChannel: "sms",
        recipientPhone: "+15551234567",
      });

    expect(res.status).toBe(201);
    expect(res.body.whisperChannel).toBe("sms");
    expect(res.body.recipientPhone).toBe("+15551234567");
  });

  it("enforces the free plan's monthly Whisper Link limit", async () => {
    for (let i = 0; i < 3; i++) {
      const res = await request(app)
        .post("/api/whisps")
        .set(asUser(USER_A))
        .send({
          videoUrl: "https://youtu.be/x",
          deliveryMethod: "whisper_link",
          whisperChannel: "email",
          recipientEmail: "friend@example.com",
        });
      expect(res.status).toBe(201);
    }

    const blocked = await request(app)
      .post("/api/whisps")
      .set(asUser(USER_A))
      .send({
        videoUrl: "https://youtu.be/x",
        deliveryMethod: "whisper_link",
        whisperChannel: "email",
        recipientEmail: "friend@example.com",
      });

    expect(blocked.status).toBe(402);
  });

  it("rejects Ghost Boost when the sender has no credits", async () => {
    const res = await request(app)
      .post("/api/whisps")
      .set(asUser(USER_A))
      .send({ videoUrl: "https://youtu.be/x", deliveryMethod: "ghost_boost" });

    expect(res.status).toBe(402);
  });

  it("spends a credit and queues the whisp when Ghost Boost is used", async () => {
    // Prime the user with a boost credit via the profile ensure + a direct update.
    await request(app).get("/api/user/profile").set(asUser(USER_A));
    const before = await getUser(USER_A);
    await db.update(usersTable).set({ boostCredits: 1 }).where(eq(usersTable.id, before.id));

    const res = await request(app)
      .post("/api/whisps")
      .set(asUser(USER_A))
      .send({ videoUrl: "https://youtu.be/x", deliveryMethod: "ghost_boost" });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe("pending");
    expect(res.body.deliveredAt).toBeNull();
    expect(res.body.boostSpendUsd).not.toBeNull();

    const after = await getUser(USER_A);
    expect(after.boostCredits).toBe(0);
  });

  it("accepts Circle Drop whisps without any recipient info", async () => {
    const res = await request(app)
      .post("/api/whisps")
      .set(asUser(USER_A))
      .send({ videoUrl: "https://youtu.be/x", deliveryMethod: "circle_drop", moodTag: "just-because" });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe("delivered");
    expect(res.body.recipientEmail).toBeNull();
  });
});

describe("Scheduled sending", () => {
  it("queues a future-dated whisper_link as scheduled instead of delivering immediately", async () => {
    const futureDate = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const res = await request(app)
      .post("/api/whisps")
      .set(asUser(USER_A))
      .send({
        videoUrl: "https://youtu.be/x",
        deliveryMethod: "whisper_link",
        whisperChannel: "email",
        recipientEmail: "friend@example.com",
        scheduledAt: futureDate,
      });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe("scheduled");
    expect(res.body.deliveredAt).toBeNull();
    expect(res.body.scheduledAt).not.toBeNull();
  });

  it("delivers immediately when scheduledAt is in the past", async () => {
    const pastDate = new Date(Date.now() - 60 * 1000).toISOString();
    const res = await request(app)
      .post("/api/whisps")
      .set(asUser(USER_A))
      .send({
        videoUrl: "https://youtu.be/x",
        deliveryMethod: "whisper_link",
        whisperChannel: "email",
        recipientEmail: "friend@example.com",
        scheduledAt: pastDate,
      });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe("delivered");
    expect(res.body.deliveredAt).not.toBeNull();
  });

  it("rejects a schedule further out than the general max", async () => {
    const tooFar = new Date(Date.now() + 45 * 24 * 60 * 60 * 1000).toISOString();
    const res = await request(app)
      .post("/api/whisps")
      .set(asUser(USER_A))
      .send({
        videoUrl: "https://youtu.be/x",
        deliveryMethod: "whisper_link",
        whisperChannel: "email",
        recipientEmail: "friend@example.com",
        scheduledAt: tooFar,
      });

    expect(res.status).toBe(400);
  });

  it("does not spend the sender's Whisper Link quota when a schedule is rejected", async () => {
    const tooFar = new Date(Date.now() + 45 * 24 * 60 * 60 * 1000).toISOString();
    await request(app)
      .post("/api/whisps")
      .set(asUser(USER_A))
      .send({
        videoUrl: "https://youtu.be/x",
        deliveryMethod: "whisper_link",
        whisperChannel: "email",
        recipientEmail: "friend@example.com",
        scheduledAt: tooFar,
      });

    const user = await getUser(USER_A);
    expect(user.whisperLinksUsed).toBe(0);
  });

  it("ignores scheduledAt for Ghost Boost, which is always queued as pending", async () => {
    await request(app).get("/api/user/profile").set(asUser(USER_A));
    const user = await getUser(USER_A);
    await db.update(usersTable).set({ boostCredits: 1 }).where(eq(usersTable.id, user.id));

    const futureDate = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const res = await request(app)
      .post("/api/whisps")
      .set(asUser(USER_A))
      .send({ videoUrl: "https://youtu.be/x", deliveryMethod: "ghost_boost", scheduledAt: futureDate });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe("pending");
  });
});

describe("Timestamp bookmarking", () => {
  it("stores and returns videoStartSeconds", async () => {
    const res = await request(app)
      .post("/api/whisps")
      .set(asUser(USER_A))
      .send({ videoUrl: "https://youtu.be/x", deliveryMethod: "circle_drop", videoStartSeconds: 84 });

    expect(res.status).toBe(201);
    expect(res.body.videoStartSeconds).toBe(84);
  });
});

describe("Video trimming", () => {
  it("stores and returns videoEndSeconds alongside a start bookmark", async () => {
    const res = await request(app)
      .post("/api/whisps")
      .set(asUser(USER_A))
      .send({ videoUrl: "https://youtu.be/x", deliveryMethod: "circle_drop", videoStartSeconds: 30, videoEndSeconds: 90 });

    expect(res.status).toBe(201);
    expect(res.body.videoStartSeconds).toBe(30);
    expect(res.body.videoEndSeconds).toBe(90);
  });

  it("allows an end time with no start time", async () => {
    const res = await request(app)
      .post("/api/whisps")
      .set(asUser(USER_A))
      .send({ videoUrl: "https://youtu.be/x", deliveryMethod: "circle_drop", videoEndSeconds: 60 });

    expect(res.status).toBe(201);
    expect(res.body.videoEndSeconds).toBe(60);
  });

  it("rejects an end time at or before the start time", async () => {
    const atStart = await request(app)
      .post("/api/whisps")
      .set(asUser(USER_A))
      .send({ videoUrl: "https://youtu.be/x", deliveryMethod: "circle_drop", videoStartSeconds: 60, videoEndSeconds: 60 });
    expect(atStart.status).toBe(400);

    const beforeStart = await request(app)
      .post("/api/whisps")
      .set(asUser(USER_A))
      .send({ videoUrl: "https://youtu.be/x", deliveryMethod: "circle_drop", videoStartSeconds: 60, videoEndSeconds: 30 });
    expect(beforeStart.status).toBe(400);
  });

  it("exposes videoEndSeconds on the public whisp page", async () => {
    const created = await request(app)
      .post("/api/whisps")
      .set(asUser(USER_A))
      .send({ videoUrl: "https://youtu.be/x", deliveryMethod: "circle_drop", videoEndSeconds: 45 });

    const publicView = await request(app).get(`/api/public/w/${created.body.publicToken}`);
    expect(publicView.body.videoEndSeconds).toBe(45);
  });

  it("rejects videoEndSeconds: 0 rather than silently treating it as unset", async () => {
    // 0 is falsy in JS — a naive `!data.videoEndSeconds` check would let this
    // slip past the end-after-start validation and get stored as a trim
    // that's never actually enforced during playback.
    const res = await request(app)
      .post("/api/whisps")
      .set(asUser(USER_A))
      .send({ videoUrl: "https://youtu.be/x", deliveryMethod: "circle_drop", videoStartSeconds: 30, videoEndSeconds: 0 });
    expect(res.status).toBe(400);
  });

  it("rejects an implausibly large trim value", async () => {
    const res = await request(app)
      .post("/api/whisps")
      .set(asUser(USER_A))
      .send({ videoUrl: "https://youtu.be/x", deliveryMethod: "circle_drop", videoEndSeconds: 99999999999 });
    expect(res.status).toBe(400);
  });
});

describe("GET /api/whisps", () => {
  it("only returns whisps belonging to the authenticated user", async () => {
    await request(app)
      .post("/api/whisps")
      .set(asUser(USER_A))
      .send({ videoUrl: "https://youtu.be/a", deliveryMethod: "circle_drop" });
    await request(app)
      .post("/api/whisps")
      .set(asUser(USER_B))
      .send({ videoUrl: "https://youtu.be/b", deliveryMethod: "circle_drop" });

    const res = await request(app).get("/api/whisps").set(asUser(USER_A));
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].videoUrl).toBe("https://youtu.be/a");
  });
});

describe("Reveal flow", () => {
  it("lets the sender request a reveal and the recipient respond", async () => {
    const created = await request(app)
      .post("/api/whisps")
      .set(asUser(USER_A))
      .send({ videoUrl: "https://youtu.be/a", deliveryMethod: "circle_drop" });
    const whispId = created.body.id;

    const revealRequested = await request(app).post(`/api/whisps/${whispId}/reveal`).set(asUser(USER_A));
    expect(revealRequested.status).toBe(200);
    expect(revealRequested.body.revealRequested).toBe(true);

    const responded = await request(app).patch(`/api/whisps/${whispId}/reveal`).send({ accepted: true });
    expect(responded.status).toBe(200);
    expect(responded.body.revealAccepted).toBe(true);
  });

  it("rejects a reveal response when no reveal was requested", async () => {
    const created = await request(app)
      .post("/api/whisps")
      .set(asUser(USER_A))
      .send({ videoUrl: "https://youtu.be/a", deliveryMethod: "circle_drop" });

    const responded = await request(app).patch(`/api/whisps/${created.body.id}/reveal`).send({ accepted: true });
    expect(responded.status).toBe(400);
  });

  it("never exposes sender/recipient PII from the unauthenticated reveal-response endpoint", async () => {
    const created = await request(app)
      .post("/api/whisps")
      .set(asUser(USER_A))
      .send({
        videoUrl: "https://youtu.be/a",
        deliveryMethod: "whisper_link",
        whisperChannel: "email",
        recipientEmail: "recipient@example.com",
      });
    const whispId = created.body.id;

    await request(app).post(`/api/whisps/${whispId}/reveal`).set(asUser(USER_A));
    const responded = await request(app).patch(`/api/whisps/${whispId}/reveal`).send({ accepted: true });

    expect(responded.status).toBe(200);
    expect(responded.body).not.toHaveProperty("senderId");
    expect(responded.body).not.toHaveProperty("recipientEmail");
    expect(responded.body).not.toHaveProperty("recipientPhone");
  });
});

describe("DELETE /api/whisps/:id", () => {
  // Dedicated users, not USER_A/USER_B: createWhispLimiter is in-memory and
  // keyed per user for the lifetime of this test file, so reusing USER_A's
  // budget here would push it toward the shared 30/hour cap other
  // describe blocks in this file also rely on staying under.
  const USER_C = "clerk_user_c";
  const USER_D = "clerk_user_d";

  it("soft-deletes: hides the whisp from the sender without touching the row, its replies, or tracking events", async () => {
    const created = await request(app)
      .post("/api/whisps")
      .set(asUser(USER_C))
      .send({ videoUrl: "https://youtu.be/a", deliveryMethod: "circle_drop" });
    const whispId = created.body.id;

    const reply = await request(app)
      .post(`/api/whisps/${whispId}/replies`)
      .set(asUser(USER_C))
      .send({ replyText: "a reply worth keeping", fromRecipient: true });
    expect(reply.status).toBe(201);

    const del = await request(app).delete(`/api/whisps/${whispId}`).set(asUser(USER_C));
    expect(del.status).toBe(204);

    const list = await request(app).get("/api/whisps").set(asUser(USER_C));
    expect(list.body.find((w: { id: string }) => w.id === whispId)).toBeUndefined();

    const detail = await request(app).get(`/api/whisps/${whispId}`).set(asUser(USER_C));
    expect(detail.status).toBe(404);

    const [row] = await db.select().from(whispsTable).where(eq(whispsTable.id, whispId));
    expect(row).toBeTruthy();
    expect(row.deletedBySenderAt).toBeTruthy();

    const replies = await db.select().from(whispRepliesTable).where(eq(whispRepliesTable.whispId, whispId));
    expect(replies).toHaveLength(1);
  });

  it("404s for a whisp belonging to another user", async () => {
    const created = await request(app)
      .post("/api/whisps")
      .set(asUser(USER_C))
      .send({ videoUrl: "https://youtu.be/a", deliveryMethod: "circle_drop" });

    const del = await request(app).delete(`/api/whisps/${created.body.id}`).set(asUser(USER_D));
    expect(del.status).toBe(404);
  });
});

describe("GET /api/whisps/:id — reply read receipts", () => {
  const USER_E = "clerk_user_e";

  it("marks the recipient's replies read the moment the sender views the thread", async () => {
    const created = await request(app)
      .post("/api/whisps")
      .set(asUser(USER_E))
      .send({ videoUrl: "https://youtu.be/a", deliveryMethod: "circle_drop" });
    const whispId = created.body.id;

    // A real recipient-authored row — the only route that can produce
    // fromRecipient=true is the public one; POST /api/whisps/:id/replies is
    // sender-only and ignores any fromRecipient the client sends (see its
    // own comment), so that route can't stand in for this.
    const reply = await request(app)
      .post(`/api/public/w/${created.body.publicToken}/reply`)
      .send({ replyText: "a reply from the recipient" });
    expect(reply.body.readAt).toBeNull();

    const firstView = await request(app).get(`/api/whisps/${whispId}`).set(asUser(USER_E));
    expect(firstView.body.replies[0].readAt).toBeTruthy();

    // A sender-authored follow-up should never get marked "read" by the
    // sender's own view — only the recipient side of the conversation does
    // that, in GET /api/public/w/:token (see public.test.ts).
    const followUp = await request(app)
      .post(`/api/whisps/${whispId}/replies`)
      .set(asUser(USER_E))
      .send({ replyText: "a follow-up from the sender", fromRecipient: false });
    const secondView = await request(app).get(`/api/whisps/${whispId}`).set(asUser(USER_E));
    const senderReply = secondView.body.replies.find((r: { id: string }) => r.id === followUp.body.id);
    expect(senderReply.readAt).toBeNull();
  });
});

describe("GET /api/public/circle", () => {
  it("lists Circle Drop whisps without exposing sender identity fields", async () => {
    await request(app)
      .post("/api/whisps")
      .set(asUser(USER_A))
      .send({ videoUrl: "https://youtu.be/a", deliveryMethod: "circle_drop", anonymousNote: "hi" });
    await request(app)
      .post("/api/whisps")
      .set(asUser(USER_A))
      .send({
        videoUrl: "https://youtu.be/b",
        deliveryMethod: "whisper_link",
        whisperChannel: "email",
        recipientEmail: "x@example.com",
      });

    const res = await request(app).get("/api/public/circle");
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].videoUrl).toBe("https://youtu.be/a");
    expect(res.body.items[0]).not.toHaveProperty("senderId");
    expect(res.body.items[0]).not.toHaveProperty("recipientEmail");
  });
});

describe("POST /api/whisps — video field security", () => {
  const USER_SEC = "clerk_user_sec_whisps";

  it("rejects a javascript: video URL (stored-XSS guard)", async () => {
    const res = await request(app)
      .post("/api/whisps")
      .set(asUser(USER_SEC))
      .send({ videoUrl: "javascript:alert(document.cookie)", deliveryMethod: "circle_drop" });
    expect(res.status).toBe(400);
  });

  it("ignores client-supplied embed/thumbnail/platform and derives them from the URL", async () => {
    const res = await request(app)
      .post("/api/whisps")
      .set(asUser(USER_SEC))
      .send({
        videoUrl: "https://youtu.be/dQw4w9WgXcQ",
        videoEmbedUrl: "https://attacker.example/phish",
        videoThumbnail: "https://attacker.example/track.gif",
        videoPlatform: "youtube",
        deliveryMethod: "circle_drop",
      });
    expect(res.status).toBe(201);
    expect(res.body.videoEmbedUrl).toBe("https://www.youtube.com/embed/dQw4w9WgXcQ?enablejsapi=1");
    expect(res.body.videoThumbnail).toBe("https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg");
    expect(res.body.videoEmbedUrl).not.toContain("attacker.example");
    expect(res.body.videoThumbnail).not.toContain("attacker.example");
  });

  it("enforces the free-plan Whisper Link limit even under repeated sends", async () => {
    const USER_LIMIT = "clerk_user_limit_whisps";
    const send = () =>
      request(app)
        .post("/api/whisps")
        .set(asUser(USER_LIMIT))
        .send({
          videoUrl: "https://youtu.be/dQw4w9WgXcQ",
          deliveryMethod: "whisper_link",
          whisperChannel: "email",
          recipientEmail: "friend@example.com",
        });

    // Free plan allows 3 Whisper Links per rolling window.
    expect((await send()).status).toBe(201);
    expect((await send()).status).toBe(201);
    expect((await send()).status).toBe(201);
    const fourth = await send();
    expect(fourth.status).toBe(402);
  });
});

describe("POST /api/whisps — recipient contact validation", () => {
  const USER_CONTACT = "clerk_user_contact_validation";

  // nodemailer parses `to` as an ADDRESS LIST, so an unvalidated
  // comma-separated value delivered one whisp to every address in it —
  // fanning a single Whisper Link out to arbitrarily many strangers and
  // sending real mail from the app's own domain on demand.
  it("rejects a comma-separated recipient email (multi-recipient injection)", async () => {
    const res = await request(app)
      .post("/api/whisps")
      .set(asUser(USER_CONTACT))
      .send({
        videoUrl: "https://youtu.be/dQw4w9WgXcQ",
        deliveryMethod: "whisper_link",
        whisperChannel: "email",
        recipientEmail: "victim@example.com, attacker@evil.com",
      });
    expect(res.status).toBe(400);
  });

  it("rejects a recipient email carrying CRLF (header-injection shaped)", async () => {
    const res = await request(app)
      .post("/api/whisps")
      .set(asUser(USER_CONTACT))
      .send({
        videoUrl: "https://youtu.be/dQw4w9WgXcQ",
        deliveryMethod: "whisper_link",
        whisperChannel: "email",
        recipientEmail: "victim@example.com\r\nBcc: attacker@evil.com",
      });
    expect(res.status).toBe(400);
  });

  it("rejects a non-phone-shaped recipient phone", async () => {
    const res = await request(app)
      .post("/api/whisps")
      .set(asUser(USER_CONTACT))
      .send({
        videoUrl: "https://youtu.be/dQw4w9WgXcQ",
        deliveryMethod: "whisper_link",
        whisperChannel: "sms",
        recipientPhone: "+15551234567, +15559999999",
      });
    expect(res.status).toBe(400);
  });

  it("still accepts a single ordinary email and phone", async () => {
    const email = await request(app)
      .post("/api/whisps")
      .set(asUser(USER_CONTACT))
      .send({
        videoUrl: "https://youtu.be/dQw4w9WgXcQ",
        deliveryMethod: "whisper_link",
        whisperChannel: "email",
        recipientEmail: "friend@example.com",
      });
    expect(email.status).toBe(201);

    const sms = await request(app)
      .post("/api/whisps")
      .set(asUser(USER_CONTACT))
      .send({
        videoUrl: "https://youtu.be/dQw4w9WgXcQ",
        deliveryMethod: "whisper_link",
        whisperChannel: "sms",
        recipientPhone: "+1 (555) 123-4567",
      });
    expect(sms.status).toBe(201);
  });
});

describe("POST /api/whisps — video thumbnail handling", () => {
  const USER_THUMB = "clerk_user_thumb";

  // Regression: server-side derivation only knows how to build a thumbnail
  // URL for YouTube, so discarding the client's scraped one outright left
  // every other platform with no preview at all. A scraped thumbnail from a
  // real platform CDN is kept; anything else still isn't.
  it("keeps a scraped thumbnail from a real platform CDN on a non-YouTube whisp", async () => {
    const res = await request(app)
      .post("/api/whisps")
      .set(asUser(USER_THUMB))
      .send({
        videoUrl: "https://www.tiktok.com/@a/video/123",
        videoThumbnail: "https://p16-sign-va.tiktokcdn.com/obj/abc123",
        deliveryMethod: "circle_drop",
      });
    expect(res.status).toBe(201);
    expect(res.body.videoThumbnail).toBe("https://p16-sign-va.tiktokcdn.com/obj/abc123");
  });

  it("still rejects a thumbnail from a host outside the platform allowlist", async () => {
    const res = await request(app)
      .post("/api/whisps")
      .set(asUser(USER_THUMB))
      .send({
        videoUrl: "https://www.tiktok.com/@a/video/123",
        videoThumbnail: "https://attacker.example/beacon.gif",
        deliveryMethod: "circle_drop",
      });
    expect(res.status).toBe(201);
    expect(res.body.videoThumbnail).toBeNull();
  });

  it("rejects a lookalike host that merely ends with an allowlisted name", async () => {
    const res = await request(app)
      .post("/api/whisps")
      .set(asUser(USER_THUMB))
      .send({
        videoUrl: "https://www.tiktok.com/@a/video/123",
        videoThumbnail: "https://ytimg.com.attacker.example/beacon.gif",
        deliveryMethod: "circle_drop",
      });
    expect(res.status).toBe(201);
    expect(res.body.videoThumbnail).toBeNull();
  });

  it("still prefers the server-derived thumbnail for YouTube", async () => {
    const res = await request(app)
      .post("/api/whisps")
      .set(asUser(USER_THUMB))
      .send({
        videoUrl: "https://youtu.be/dQw4w9WgXcQ",
        videoThumbnail: "https://i.ytimg.com/vi/SOMETHINGELSE/hqdefault.jpg",
        deliveryMethod: "circle_drop",
      });
    expect(res.status).toBe(201);
    expect(res.body.videoThumbnail).toBe("https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg");
  });
});
