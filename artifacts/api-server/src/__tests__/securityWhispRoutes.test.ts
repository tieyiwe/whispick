import { describe, it, expect, vi } from "vitest";
import { randomUUID } from "crypto";
import request from "supertest";
import app from "../app";
import { db, usersTable, whispsTable, textWhispsTable, trackingEventsTable, pushSubscriptionsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { TEST_USER_HEADER } from "./setup";
import { isAllowedPushEndpoint } from "../lib/push";
import { maskPhone, debateTopicWhispSmsBody } from "../lib/sms";

// Ghost Boost is paused by default; the tracking-URL check below covers it
// too, so this file flips just that flag (same override whisps.test.ts uses).
vi.mock("../lib/plans", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/plans")>();
  return { ...actual, GHOST_BOOST_ENABLED: true };
});

function asUser(clerkId: string) {
  return { [TEST_USER_HEADER]: clerkId };
}

// Fresh ids per test: several limiters here are in-memory and keyed per
// user for the lifetime of this file.
function freshClerkId(label: string) {
  return `clerk_sec_${label}_${randomUUID()}`;
}

async function ensure(clerkId: string) {
  await request(app).get("/api/user/profile").set(asUser(clerkId));
  return db.select().from(usersTable).where(eq(usersTable.clerkId, clerkId)).then((r) => r[0]!);
}

// A whisper_link matched to an existing account — ensureUser gives every
// test user `${clerkId}@blindwhisper.com`.
async function sendMatchedWhisp(senderClerkId: string, recipientClerkId: string, extra: Record<string, unknown> = {}) {
  await ensure(recipientClerkId);
  return request(app)
    .post("/api/whisps")
    .set(asUser(senderClerkId))
    .send({
      videoUrl: "https://youtu.be/dQw4w9WgXcQ",
      deliveryMethod: "whisper_link",
      whisperChannel: "email",
      recipientEmail: `${recipientClerkId}@blindwhisper.com`,
      ...extra,
    });
}

describe("whisp responses never carry recipient-side or linkable ids", () => {
  it("GET /stats recentWhisps and POST /:id/reveal go through the safe serializer", async () => {
    const sender = freshClerkId("stats_sender");
    const recipient = freshClerkId("stats_recipient");
    const sent = await sendMatchedWhisp(sender, recipient);
    expect(sent.status).toBe(201);

    const stats = await request(app).get("/api/whisps/stats").set(asUser(sender));
    expect(stats.status).toBe(200);
    expect(stats.body.recentWhisps).toHaveLength(1);
    for (const field of ["recipientUserId", "recipientPinnedAt", "recipientArchivedAt", "videoReplyRequestNotifyAt"]) {
      expect(stats.body.recentWhisps[0]).not.toHaveProperty(field);
    }

    const reveal = await request(app).post(`/api/whisps/${sent.body.id}/reveal`).set(asUser(sender));
    expect(reveal.status).toBe(200);
    expect(reveal.body.revealRequested).toBe(true);
    expect(reveal.body).not.toHaveProperty("recipientUserId");
    expect(reveal.body).not.toHaveProperty("recipientPinnedAt");
  });

  it("a recipient's view omits groupSendId/whisperGroupId/conciergeRequestId/deletedBySenderAt", async () => {
    const sender = freshClerkId("allow_sender");
    const recipient = freshClerkId("allow_recipient");
    const sent = await sendMatchedWhisp(sender, recipient);
    await db
      .update(whispsTable)
      .set({ groupSendId: randomUUID(), whisperGroupId: randomUUID(), conciergeRequestId: randomUUID() })
      .where(eq(whispsTable.id, sent.body.id));

    const received = await request(app).get("/api/whisps?box=received").set(asUser(recipient));
    expect(received.body).toHaveLength(1);
    const view = received.body[0];
    for (const field of ["groupSendId", "whisperGroupId", "conciergeRequestId", "deletedBySenderAt", "uploadedVideoId", "recipientUserId"]) {
      expect(view).not.toHaveProperty(field);
    }
    expect(view.senderId).toBeNull();
    expect(view.viewerRole).toBe("recipient");
    expect(view.publicToken).toBeTruthy();
  });

  it("the sender's whisp detail never includes the recipient's user agent or ip hash", async () => {
    const sender = freshClerkId("ua_sender");
    const created = await request(app)
      .post("/api/whisps")
      .set(asUser(sender))
      .send({ videoUrl: "https://youtu.be/dQw4w9WgXcQ", deliveryMethod: "circle_drop" });
    await db.insert(trackingEventsTable).values({
      id: randomUUID(),
      whispId: created.body.id,
      eventType: "opened",
      userAgent: "Mozilla/5.0 (iPhone; very identifying)",
      ipHash: "abc123",
    });

    const detail = await request(app).get(`/api/whisps/${created.body.id}`).set(asUser(sender));
    expect(detail.body.trackingEvents).toHaveLength(1);
    expect(detail.body.trackingEvents[0]).not.toHaveProperty("userAgent");
    expect(detail.body.trackingEvents[0]).not.toHaveProperty("ipHash");
    expect(detail.body.trackingEvents[0].eventType).toBe("opened");
  });
});

describe("scheduled, cancelled and removed whisps stay out of the recipient's box", () => {
  it("hides a scheduled whisp from Received and the unread count, and cancels it when deleted", async () => {
    const sender = freshClerkId("sched_sender");
    const recipient = freshClerkId("sched_recipient");
    const sent = await sendMatchedWhisp(sender, recipient, { scheduledAt: new Date(Date.now() + 60 * 60 * 1000).toISOString() });
    expect(sent.body.status).toBe("scheduled");

    const received = await request(app).get("/api/whisps?box=received").set(asUser(recipient));
    expect(received.body).toHaveLength(0);
    const unread = await request(app).get("/api/whisps/received-unread-count").set(asUser(recipient));
    expect(unread.body.unreadCount).toBe(0);
    const pin = await request(app).post(`/api/whisps/${sent.body.id}/pin`).set(asUser(recipient));
    expect(pin.status).toBe(404);

    const del = await request(app).delete(`/api/whisps/${sent.body.id}`).set(asUser(sender));
    expect(del.status).toBe(204);
    const [row] = await db.select().from(whispsTable).where(eq(whispsTable.id, sent.body.id));
    expect(row!.status).toBe("cancelled");
  });

  it("a delivered whisp the sender later deletes stays visible to the recipient (unchanged)", async () => {
    const sender = freshClerkId("del_sender");
    const recipient = freshClerkId("del_recipient");
    const sent = await sendMatchedWhisp(sender, recipient);
    await request(app).delete(`/api/whisps/${sent.body.id}`).set(asUser(sender));

    const [row] = await db.select().from(whispsTable).where(eq(whispsTable.id, sent.body.id));
    expect(row!.status).not.toBe("cancelled");
    const received = await request(app).get("/api/whisps?box=received").set(asUser(recipient));
    expect(received.body).toHaveLength(1);
  });

  it("hides an admin-removed whisp from Received", async () => {
    const sender = freshClerkId("rm_sender");
    const recipient = freshClerkId("rm_recipient");
    const sent = await sendMatchedWhisp(sender, recipient);
    await db.update(whispsTable).set({ removedByAdminAt: new Date() }).where(eq(whispsTable.id, sent.body.id));

    const received = await request(app).get("/api/whisps?box=received").set(asUser(recipient));
    expect(received.body).toHaveLength(0);
  });
});

describe("Blind Circle posts reject person-to-person sender actions", () => {
  it("rejects follow-ups, reveals and guess reactions on a circle_drop", async () => {
    const sender = freshClerkId("circle_sender");
    const created = await request(app)
      .post("/api/whisps")
      .set(asUser(sender))
      .send({ videoUrl: "https://youtu.be/dQw4w9WgXcQ", deliveryMethod: "circle_drop" });
    const { id, publicToken } = created.body;

    const followUp = await request(app).post(`/api/whisps/${id}/replies`).set(asUser(sender)).send({ replyText: "it was me" });
    expect(followUp.status).toBe(400);

    const reveal = await request(app).post(`/api/whisps/${id}/reveal`).set(asUser(sender));
    expect(reveal.status).toBe(400);

    const guess = await request(app).post(`/api/public/w/${publicToken}/reply`).send({ replyText: "Sam?", isGuess: true });
    if (guess.status === 201) {
      const reaction = await request(app)
        .patch(`/api/whisps/${id}/replies/${guess.body.id}/guess-reaction`)
        .set(asUser(sender))
        .send({ reaction: "confirmed" });
      expect(reaction.status).toBe(400);
    }

    const respond = await request(app).patch(`/api/whisps/${id}/reveal`).send({ accepted: true });
    expect(respond.status).toBe(400);
  });
});

describe("video URL restrictions for anonymous-viewer delivery methods", () => {
  it("rejects an arbitrary https URL on circle_drop and ghost_boost, accepts it on whisper_link", async () => {
    const sender = freshClerkId("url_sender");
    await ensure(sender);
    await db.update(usersTable).set({ boostCredits: 5 }).where(eq(usersTable.clerkId, sender));

    for (const deliveryMethod of ["circle_drop", "ghost_boost"]) {
      const res = await request(app)
        .post("/api/whisps")
        .set(asUser(sender))
        .send({ videoUrl: "https://tracker.example/pixel.mp4", deliveryMethod });
      expect(res.status).toBe(400);
    }

    const ok = await request(app)
      .post("/api/whisps")
      .set(asUser(sender))
      .send({ videoUrl: "https://youtu.be/dQw4w9WgXcQ", deliveryMethod: "circle_drop" });
    expect(ok.status).toBe(201);

    const link = await request(app)
      .post("/api/whisps")
      .set(asUser(sender))
      .send({
        videoUrl: "https://example.com/my-video.mp4",
        deliveryMethod: "whisper_link",
        whisperChannel: "email",
        recipientEmail: "friend@example.com",
      });
    expect(link.status).toBe(201);
  });

  it("bounds free-text fields", async () => {
    const sender = freshClerkId("bounds_sender");
    const res = await request(app)
      .post("/api/whisps")
      .set(asUser(sender))
      .send({ videoUrl: "https://youtu.be/dQw4w9WgXcQ", deliveryMethod: "circle_drop", anonymousNote: "x".repeat(1001) });
    expect(res.status).toBe(400);
  });
});

describe("reveal request rate limit", () => {
  it("caps reveal requests per sender per hour", async () => {
    const sender = freshClerkId("reveal_rl_sender");
    const created = await request(app)
      .post("/api/whisps")
      .set(asUser(sender))
      .send({
        videoUrl: "https://youtu.be/dQw4w9WgXcQ",
        deliveryMethod: "whisper_link",
        whisperChannel: "email",
        recipientEmail: "friend@example.com",
      });
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      statuses.push((await request(app).post(`/api/whisps/${created.body.id}/reveal`).set(asUser(sender))).status);
    }
    expect(statuses.slice(0, 5).every((s) => s === 200)).toBe(true);
    expect(statuses[5]).toBe(429);
  });
});

describe("Text Whisps", () => {
  const PHONE = "+15557654321";

  async function setup() {
    const senderClerkId = freshClerkId("tw_sender");
    const recipientClerkId = freshClerkId("tw_recipient");
    await ensure(senderClerkId);
    await ensure(recipientClerkId);
    await db.update(usersTable).set({ phone: PHONE, phoneVerifiedAt: new Date() }).where(eq(usersTable.clerkId, recipientClerkId));
    return { senderClerkId, recipientClerkId };
  }

  it("never returns a reply's author id — only the caller-relative fromViewer", async () => {
    const { senderClerkId, recipientClerkId } = await setup();
    const created = await request(app)
      .post("/api/text-whisps")
      .set(asUser(senderClerkId))
      .send({ recipientPhone: PHONE, messageText: "hi", smsConsentConfirmed: true });
    expect(created.status).toBe(201);

    await request(app).post(`/api/text-whisps/${created.body.id}/replies`).set(asUser(senderClerkId)).send({ replyText: "from sender" });
    await request(app).post(`/api/text-whisps/${created.body.id}/replies`).set(asUser(recipientClerkId)).send({ replyText: "from recipient" });

    const asRecipient = await request(app).get(`/api/text-whisps/${created.body.id}`).set(asUser(recipientClerkId));
    expect(asRecipient.status).toBe(200);
    for (const reply of asRecipient.body.replies) expect(reply).not.toHaveProperty("senderId");
    const byText = Object.fromEntries(asRecipient.body.replies.map((r: any) => [r.replyText, r.fromViewer]));
    expect(byText).toEqual({ "from sender": false, "from recipient": true });

    const list = await request(app).get(`/api/text-whisps/${created.body.id}/replies`).set(asUser(senderClerkId));
    const senderView = Object.fromEntries(list.body.map((r: any) => [r.replyText, r.fromViewer]));
    expect(senderView).toEqual({ "from sender": true, "from recipient": false });
    for (const reply of list.body) expect(reply).not.toHaveProperty("senderId");
  });

  it("hides a scheduled Text Whisp from the recipient and cancels it on delete", async () => {
    const { senderClerkId, recipientClerkId } = await setup();
    const created = await request(app)
      .post("/api/text-whisps")
      .set(asUser(senderClerkId))
      .send({ recipientPhone: PHONE, messageText: "later", smsConsentConfirmed: true, scheduledAt: new Date(Date.now() + 3600_000).toISOString() });
    expect(created.body.status).toBe("scheduled");

    const list = await request(app).get("/api/text-whisps").set(asUser(recipientClerkId));
    expect(list.body.find((t: any) => t.id === created.body.id)).toBeUndefined();
    const detail = await request(app).get(`/api/text-whisps/${created.body.id}`).set(asUser(recipientClerkId));
    expect(detail.status).toBe(404);

    await request(app).delete(`/api/text-whisps/${created.body.id}`).set(asUser(senderClerkId));
    const [row] = await db.select().from(textWhispsTable).where(eq(textWhispsTable.id, created.body.id));
    expect(row!.status).toBe("cancelled");
  });
});

describe("circles and invites never return other users' account ids", () => {
  it("replaces ownerId with a caller-relative isOwner", async () => {
    const owner = freshClerkId("circle_owner");
    const member = freshClerkId("circle_member");
    const created = await request(app).post("/api/circles").set(asUser(owner)).send({ name: "Friends" });
    expect(created.body).not.toHaveProperty("ownerId");
    expect(created.body.isOwner).toBe(true);

    const joined = await request(app).post("/api/circles/join").set(asUser(member)).send({ inviteCode: created.body.inviteCode });
    expect(joined.body).not.toHaveProperty("ownerId");
    expect(joined.body.isOwner).toBe(false);

    const list = await request(app).get("/api/circles").set(asUser(member));
    expect(list.body[0]).not.toHaveProperty("ownerId");
    expect(list.body[0].isOwner).toBe(false);
  });
});

describe("push subscriptions", () => {
  it("only accepts real browser push service endpoints", () => {
    expect(isAllowedPushEndpoint("https://fcm.googleapis.com/fcm/send/abc")).toBe(true);
    expect(isAllowedPushEndpoint("https://updates.push.services.mozilla.com/wpush/v2/abc")).toBe(true);
    expect(isAllowedPushEndpoint("https://web.push.apple.com/QGx")).toBe(true);
    expect(isAllowedPushEndpoint("https://wns2-par02p.notify.windows.com/w/?token=x")).toBe(true);
    expect(isAllowedPushEndpoint("https://fcm.googleapis.com:443/fcm/send/abc")).toBe(true);

    expect(isAllowedPushEndpoint("http://fcm.googleapis.com/fcm/send/abc")).toBe(false);
    expect(isAllowedPushEndpoint("https://fcm.googleapis.com:8443/fcm/send/abc")).toBe(false);
    expect(isAllowedPushEndpoint("https://169.254.169.254/latest/meta-data")).toBe(false);
    expect(isAllowedPushEndpoint("https://fcm.googleapis.com.attacker.example/x")).toBe(false);
    expect(isAllowedPushEndpoint("https://evilnotify.windows.com.example/x")).toBe(false);
    expect(isAllowedPushEndpoint("not a url")).toBe(false);
  });

  it("rejects a non-allowlisted endpoint at registration", async () => {
    const user = freshClerkId("push_bad");
    const res = await request(app)
      .post("/api/user/push-subscription")
      .set(asUser(user))
      .send({ endpoint: "https://internal.example:6379/", keys: { p256dh: "p", auth: "a" } });
    expect(res.status).toBe(400);
  });

  it("keeps at most 10 subscriptions per user and re-homes a shared endpoint", async () => {
    const userA = freshClerkId("push_a");
    const userB = freshClerkId("push_b");
    for (let i = 0; i < 12; i++) {
      const res = await request(app)
        .post("/api/user/push-subscription")
        .set(asUser(userA))
        .send({ endpoint: `https://fcm.googleapis.com/fcm/send/a${i}`, keys: { p256dh: "p", auth: "a" } });
      expect(res.status).toBe(201);
    }
    const a = await ensure(userA);
    const rowsA = await db.select().from(pushSubscriptionsTable).where(eq(pushSubscriptionsTable.userId, a.id));
    expect(rowsA).toHaveLength(10);

    const shared = "https://fcm.googleapis.com/fcm/send/a11";
    await request(app)
      .post("/api/user/push-subscription")
      .set(asUser(userB))
      .send({ endpoint: shared, keys: { p256dh: "p2", auth: "a2" } });
    const b = await ensure(userB);
    const [row] = await db.select().from(pushSubscriptionsTable).where(eq(pushSubscriptionsTable.endpoint, shared));
    expect(row!.userId).toBe(b.id);
  });
});

describe("Debate topic whisps over SMS", () => {
  it("requires SMS consent, and never puts the sender's note in the SMS body", async () => {
    const sender = freshClerkId("dtw_sender");
    await ensure(sender);
    const topic = await request(app).post("/api/debate-topics").set(asUser(sender)).send({ topicText: "Is honesty always the best policy?" });

    const res = await request(app)
      .post(`/api/debate-topics/${topic.body.id}/whisp`)
      .set(asUser(sender))
      .send({ channel: "sms", recipientPhone: "+15551230000", note: "Verify your bank account at evil.example" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("sms_consent_required");

    const body = debateTopicWhispSmsBody("https://app.example/t/1");
    expect(body).toContain("https://app.example/t/1");
    expect(body).not.toContain("evil.example");
  });
});

describe("misc hardening", () => {
  it("masks phone numbers for logs", () => {
    expect(maskPhone("+15551234567")).toBe("***4567");
    expect(maskPhone("123")).toBe("***");
  });

  it("bounds the profile display name", async () => {
    const user = freshClerkId("profile");
    const res = await request(app).patch("/api/user/profile").set(asUser(user)).send({ fullName: "x".repeat(101) });
    expect(res.status).toBe(400);
  });
});
