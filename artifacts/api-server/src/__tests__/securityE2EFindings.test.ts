import { describe, it, expect, vi, beforeEach } from "vitest";
import { randomUUID } from "crypto";
import request from "supertest";
import app from "../app";
import { db, usersTable, whispsTable, notificationsTable, debateTopicsTable, debateTopicCommentsTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { TEST_USER_HEADER } from "./setup";
import { resetDebateTopicCountersForTests } from "../routes/debateTopics";
import { resetPublicRouteCountersForTests } from "../routes/public";
import { dispatchDueDeferredNotifications } from "../lib/replyNotificationScheduler";
import { anonymousCommentLimit } from "../lib/plans";

// Regression tests for the findings of the pre-launch black-box/white-box
// sweep run against the live e2e stack (real Express app + Postgres). Each
// block names the request that reproduced the issue live.

// Spied so the text-whisp tests can prove the anonymous sender gets no push
// in the same request as the recipient's action.
const pushMock = vi.hoisted(() => ({
  notifyUser: vi.fn(async (..._args: any[]) => 0),
}));
vi.mock("../lib/push", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/push")>()),
  ...pushMock,
}));

const objectStorageMock = vi.hoisted(() => ({
  uploadObject: vi.fn(async (_key: string, _bytes: Buffer) => true),
  downloadObject: vi.fn(async (_key: string) => Buffer.from("png-bytes")),
  deleteObject: vi.fn(async () => undefined),
}));
vi.mock("../lib/objectStorage", () => objectStorageMock);

function asUser(clerkId: string) {
  return { [TEST_USER_HEADER]: clerkId };
}

function fresh(label: string) {
  return `clerk_sxe_${label}_${randomUUID()}`;
}

async function ensure(clerkId: string) {
  await request(app).get("/api/user/profile").set(asUser(clerkId));
  return db.select().from(usersTable).where(eq(usersTable.clerkId, clerkId)).then((r) => r[0]!);
}

beforeEach(() => {
  pushMock.notifyUser.mockClear();
  resetDebateTopicCountersForTests();
  resetPublicRouteCountersForTests();
});

describe("Ghost Boost matched subscribers never reach the campaign sender", () => {
  // Live repro: GET /api/whisper-groups/sends/<campaign whisp id> → 200 with
  // members[].recipientEmail = the matched stranger's address;
  // GET /api/user/recent-recipients listed the same address.
  async function seedCampaign(senderId: string) {
    const campaignId = randomUUID();
    await db.insert(whispsTable).values({
      id: campaignId,
      senderId,
      videoUrl: "https://youtu.be/dQw4w9WgXcQ",
      deliveryMethod: "ghost_boost",
      status: "delivered",
      publicToken: randomUUID().replace(/-/g, ""),
    });
    await db.insert(whispsTable).values({
      id: randomUUID(),
      senderId,
      videoUrl: "https://youtu.be/dQw4w9WgXcQ",
      deliveryMethod: "ghost_boost",
      whisperChannel: "email",
      groupSendId: campaignId,
      recipientEmail: "matched.stranger@example.org",
      status: "delivered",
      publicToken: randomUUID().replace(/-/g, ""),
    });
    return campaignId;
  }

  it("GET /whisper-groups/sends/:groupSendId 404s for a Ghost Boost campaign id", async () => {
    const sender = fresh("gb_sender");
    const user = await ensure(sender);
    const campaignId = await seedCampaign(user.id);

    const res = await request(app).get(`/api/whisper-groups/sends/${campaignId}`).set(asUser(sender));
    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).not.toContain("matched.stranger@example.org");
  });

  it("GET /user/recent-recipients leaves matched subscribers out", async () => {
    const sender = fresh("gb_recent");
    const user = await ensure(sender);
    await seedCampaign(user.id);

    const res = await request(app).get("/api/user/recent-recipients").set(asUser(sender));
    expect(res.status).toBe(200);
    expect(res.body.items.map((i: any) => i.value)).not.toContain("matched.stranger@example.org");
  });
});

describe("Text Whisp: the recipient's actions never buzz the anonymous sender instantly", () => {
  const PHONE = "+15557654321";

  async function setup() {
    const sender = fresh("tw_sender");
    const recipient = fresh("tw_recipient");
    const senderRow = await ensure(sender);
    const recipientRow = await ensure(recipient);
    await db.update(usersTable).set({ phone: null, phoneVerifiedAt: null }).where(eq(usersTable.phone, PHONE));
    await db.update(usersTable).set({ phone: PHONE, phoneVerifiedAt: new Date() }).where(eq(usersTable.id, recipientRow.id));
    const created = await request(app).post("/api/text-whisps").set(asUser(sender)).send({ recipientPhone: PHONE, messageText: "hi" });
    expect(created.status).toBe(201);
    return { sender, recipient, senderId: senderRow.id, recipientId: recipientRow.id, id: created.body.id as string };
  }

  function senderNotifications(senderId: string) {
    return db.select().from(notificationsTable).where(eq(notificationsTable.targetUserId, senderId));
  }

  it("a recipient reply schedules the sender's notification 3/5/9 minutes out (live repro: notification created 3 ms after the reply)", async () => {
    const { recipient, senderId, sender, id } = await setup();
    pushMock.notifyUser.mockClear();

    const before = Date.now();
    const reply = await request(app).post(`/api/text-whisps/${id}/replies`).set(asUser(recipient)).send({ replyText: "who is this?" });
    expect(reply.status).toBe(201);

    const rows = await senderNotifications(senderId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.kind).toBe("reply");
    expect(rows[0]!.deliverAfter).not.toBeNull();
    expect([3, 5, 9]).toContain(Math.round((rows[0]!.deliverAfter!.getTime() - before) / 60_000));
    expect(pushMock.notifyUser).not.toHaveBeenCalledWith(senderId, expect.anything(), expect.anything(), expect.anything());

    const bell = await request(app).get("/api/user/notifications").set(asUser(sender));
    expect(bell.body.items).toHaveLength(0);

    // Released by the dispatcher: visible and pushed.
    await db.update(notificationsTable).set({ deliverAfter: new Date(Date.now() - 1000) }).where(eq(notificationsTable.id, rows[0]!.id));
    await dispatchDueDeferredNotifications();
    expect(pushMock.notifyUser).toHaveBeenCalledWith(senderId, "New reply on your Text Whisp", expect.any(String), `/text-whisps/${id}`);
    const released = await request(app).get("/api/user/notifications").set(asUser(sender));
    expect(released.body.items.some((n: any) => n.kind === "reply")).toBe(true);
  });

  it("a reveal response is deferred too", async () => {
    const { sender, recipient, senderId, id } = await setup();
    expect((await request(app).post(`/api/text-whisps/${id}/reveal`).set(asUser(sender))).status).toBe(200);

    const res = await request(app).post(`/api/text-whisps/${id}/reveal/respond`).set(asUser(recipient)).send({ accepted: false });
    expect(res.status).toBe(200);
    const rows = await senderNotifications(senderId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.kind).toBe("text_whisp_reveal_response");
    expect(rows[0]!.deliverAfter).not.toBeNull();
  });

  it("the sender's own follow-up still reaches the recipient right away", async () => {
    const { sender, recipientId, id } = await setup();
    await db.delete(notificationsTable).where(eq(notificationsTable.targetUserId, recipientId));
    const res = await request(app).post(`/api/text-whisps/${id}/replies`).set(asUser(sender)).send({ replyText: "a friend" });
    expect(res.status).toBe(201);
    await vi.waitFor(async () => {
      const rows = await db.select().from(notificationsTable).where(and(eq(notificationsTable.targetUserId, recipientId), eq(notificationsTable.kind, "reply")));
      expect(rows).toHaveLength(1);
      expect(rows[0]!.deliverAfter).toBeNull();
    });
  });

  it("replies are rate-limited per account (each one pushes the other party)", async () => {
    const { sender, id } = await setup();
    let last = 0;
    for (let i = 0; i < 121; i++) {
      last = (await request(app).post(`/api/text-whisps/${id}/replies`).set(asUser(sender)).send({ replyText: `m${i}` })).status;
    }
    expect(last).toBe(429);
  }, 60_000);
});

describe("A suspended account loses its signed-in privileges on public routes", () => {
  // Live repro: a banned account got 403 on GET /api/user/profile but posted
  // 5/5 debate comments under its persistent handle while an anonymous
  // visitor was refused at #4.
  it("debate comments: capped like an anonymous visitor, no persistent handle", async () => {
    const author = fresh("ban_author");
    const banned = fresh("ban_user");
    const topic = await request(app).post("/api/debate-topics").set(asUser(author)).send({ topicText: "A topic" });
    const bannedRow = await ensure(banned);
    await db.update(usersTable).set({ banned: true }).where(eq(usersTable.id, bannedRow.id));

    const limit = anonymousCommentLimit()!;
    const statuses: number[] = [];
    for (let i = 0; i <= limit; i++) {
      const res = await request(app)
        .post(`/api/public/debate-topics/${topic.body.id}/comments`)
        .set(asUser(banned))
        .send({ commentText: `c${i}`, visitorId: "banned-visitor" });
      statuses.push(res.status);
    }
    expect(statuses.slice(0, limit).every((s) => s === 201)).toBe(true);
    expect(statuses[limit]).toBe(403);

    const rows = await db.select().from(debateTopicCommentsTable).where(eq(debateTopicCommentsTable.topicId, topic.body.id));
    expect(rows.every((r) => r.authorUserId === null)).toBe(true);
  });

  it("whisp replies: no signed-in exemption from the anonymous cap or the video-reply gate", async () => {
    const sender = fresh("ban_sender");
    const banned = fresh("ban_recipient");
    await ensure(sender);
    const bannedRow = await ensure(banned);
    await db.update(usersTable).set({ banned: true }).where(eq(usersTable.id, bannedRow.id));
    const sent = await request(app).post("/api/whisps").set(asUser(sender)).send({
      videoUrl: "https://youtu.be/dQw4w9WgXcQ",
      deliveryMethod: "whisper_link",
      whisperChannel: "email",
      recipientEmail: "someone@example.org",
    });
    expect(sent.status).toBe(201);
    const token = sent.body.publicToken;

    const page = await request(app).get(`/api/public/w/${token}`).set(asUser(banned));
    expect(page.body.videoRepliesAllowed).toBe(false);

    const video = await request(app).post(`/api/public/w/${token}/reply`).set(asUser(banned)).send({ videoUrl: "https://youtu.be/dQw4w9WgXcQ" });
    expect(video.status).toBe(403);

    const statuses: number[] = [];
    for (let i = 0; i < 4; i++) {
      statuses.push((await request(app).post(`/api/public/w/${token}/reply`).set(asUser(banned)).send({ replyText: `r${i}` })).status);
    }
    expect(statuses).toEqual([201, 201, 201, 403]);
  });
});

describe("Debate Now: per-thread handles can't impersonate a Whisperer handle", () => {
  // Live repro: PATCH /api/public/debate-topics/:id/handle {handle: <topic
  // author's authorHandle>} → 200, then the avatar, then a comment that
  // rendered identically to the author's byline.
  it("renaming to any account's Whisperer handle (any case) is refused as taken", async () => {
    const author = fresh("imp_author");
    const topic = await request(app).post("/api/debate-topics").set(asUser(author)).send({ topicText: "A topic" });
    const authorHandle: string = topic.body.authorHandle;

    for (const candidate of [authorHandle, authorHandle.toLowerCase()]) {
      const res = await request(app)
        .patch(`/api/public/debate-topics/${topic.body.id}/handle`)
        .send({ visitorId: "impersonator", handle: candidate });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe("taken");
    }

    const ok = await request(app).patch(`/api/public/debate-topics/${topic.body.id}/handle`).send({ visitorId: "impersonator", handle: "PlainName42" });
    expect(ok.status).toBe(200);
  });

  it("handle/avatar/reaction writes 404 for an unknown or retracted topic", async () => {
    const unknown = await request(app).patch(`/api/public/debate-topics/${randomUUID()}/handle`).send({ visitorId: "v", handle: "PlainName42" });
    expect(unknown.status).toBe(404);
    const avatar = await request(app).patch(`/api/public/debate-topics/not-a-topic/avatar`).send({ visitorId: "v", avatarId: null });
    expect(avatar.status).toBe(404);

    const author = fresh("ret_author");
    const topic = await request(app).post("/api/debate-topics").set(asUser(author)).send({ topicText: "A topic" });
    const comment = await request(app).post(`/api/public/debate-topics/${topic.body.id}/comments`).send({ commentText: "x", visitorId: "v1" });
    await db.update(debateTopicsTable).set({ removedByAdminAt: new Date() }).where(eq(debateTopicsTable.id, topic.body.id));
    const reaction = await request(app)
      .post(`/api/public/debate-topics/${topic.body.id}/comments/${comment.body.id}/reactions`)
      .send({ visitorId: "v2", reaction: "like" });
    expect(reaction.status).toBe(404);
  });

  it("a comment image stops serving once its topic is taken down", async () => {
    const author = fresh("img_author");
    const topic = await request(app).post("/api/debate-topics").set(asUser(author)).send({ topicText: "A topic" });
    const commentId = randomUUID();
    await db.insert(debateTopicCommentsTable).values({
      id: commentId,
      topicId: topic.body.id,
      visitorId: "v-img",
      commentText: "pic",
      imageObjectKey: "comment-images/x.png",
      imageModerationStatus: "ok",
    });

    expect((await request(app).get(`/api/public/debate-topics/comments/${commentId}/image`)).status).toBe(200);
    await db.update(debateTopicsTable).set({ removedByAdminAt: new Date() }).where(eq(debateTopicsTable.id, topic.body.id));
    expect((await request(app).get(`/api/public/debate-topics/comments/${commentId}/image`)).status).toBe(404);
  });
});
