import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import app from "../app";
import { db, usersTable, notificationsTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { TEST_USER_HEADER } from "./setup";
import { resetDebateTopicCountersForTests } from "../routes/debateTopics";
import { dispatchDueDeferredNotifications } from "../lib/replyNotificationScheduler";
import { anonymousCommentLimit } from "../lib/plans";

// Spied so a test can prove nothing pushes in the same request as the
// anonymous action — the side channel these deferrals exist to close.
const pushMock = vi.hoisted(() => ({
  notifyUser: vi.fn(async (..._args: any[]) => undefined),
  notifyUserPersisted: vi.fn(async (..._args: any[]) => undefined),
}));
vi.mock("../lib/push", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/push")>()),
  ...pushMock,
}));

const AUTHOR = "clerk_dt_anon_author";
const COMMENTER = "clerk_dt_anon_commenter";

function asUser(clerkId: string) {
  return { [TEST_USER_HEADER]: clerkId };
}

async function createTopic(clerkId = AUTHOR): Promise<string> {
  const res = await request(app).post("/api/debate-topics").set(asUser(clerkId)).send({ topicText: "Is honesty always the best policy?" });
  expect(res.status).toBe(201);
  return res.body.id;
}

async function userIdFor(clerkId: string): Promise<string> {
  const user = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.clerkId, clerkId)).then((r) => r[0]);
  return user!.id;
}

async function notificationsFor(userId: string, kind: string) {
  return db
    .select()
    .from(notificationsTable)
    .where(and(eq(notificationsTable.targetUserId, userId), eq(notificationsTable.kind, kind)));
}

function comment(topicId: string, body: Record<string, unknown>, opts: { clerkId?: string; ip?: string } = {}) {
  let req = request(app).post(`/api/public/debate-topics/${topicId}/comments`);
  if (opts.clerkId) req = req.set(asUser(opts.clerkId));
  if (opts.ip) req = req.set("X-Forwarded-For", opts.ip);
  return req.send({ commentText: "A take.", ...body });
}

beforeEach(() => {
  resetDebateTopicCountersForTests();
  pushMock.notifyUser.mockClear();
  pushMock.notifyUserPersisted.mockClear();
});

describe("Debate Now notifications are deferred", () => {
  it("schedules the topic author's new-comment notification 3/5/9 minutes out, hidden from the bell until released", async () => {
    const topicId = await createTopic();
    const authorId = await userIdFor(AUTHOR);

    const before = Date.now();
    expect((await comment(topicId, { visitorId: "v-anon-1" })).status).toBe(201);

    expect(pushMock.notifyUser).not.toHaveBeenCalled();
    expect(pushMock.notifyUserPersisted).not.toHaveBeenCalled();
    const [row] = await notificationsFor(authorId, "debate_topic_comment");
    expect(row?.url).toBe(`/debate-topics/${topicId}`);
    const minutes = Math.round((row!.deliverAfter!.getTime() - before) / 60_000);
    expect([3, 5, 9]).toContain(minutes);

    const bell = await request(app).get("/api/user/notifications").set(asUser(AUTHOR));
    expect(bell.body.items.some((n: any) => n.kind === "debate_topic_comment")).toBe(false);

    await db.update(notificationsTable).set({ deliverAfter: new Date(Date.now() - 1000) }).where(eq(notificationsTable.id, row!.id));
    await dispatchDueDeferredNotifications();
    expect(pushMock.notifyUser).toHaveBeenCalledWith(authorId, row!.title, row!.body, `/debate-topics/${topicId}`);
    const released = await request(app).get("/api/user/notifications").set(asUser(AUTHOR));
    expect(released.body.items.some((n: any) => n.kind === "debate_topic_comment")).toBe(true);
  });

  it("coalesces a burst of comments into one pending notification", async () => {
    const topicId = await createTopic();
    for (let i = 0; i < 3; i++) expect((await comment(topicId, { visitorId: `v-burst-${i}` })).status).toBe(201);
    expect(await notificationsFor(await userIdFor(AUTHOR), "debate_topic_comment")).toHaveLength(1);
  });

  it("defers the reply-to-your-comment notification", async () => {
    const topicId = await createTopic();
    const parent = await comment(topicId, { visitorId: "v-parent" }, { clerkId: COMMENTER });
    expect(parent.status).toBe(201);
    pushMock.notifyUserPersisted.mockClear();

    expect((await comment(topicId, { visitorId: "v-replier", parentCommentId: parent.body.id })).status).toBe(201);

    expect(pushMock.notifyUserPersisted).not.toHaveBeenCalled();
    const [row] = await notificationsFor(await userIdFor(COMMENTER), "debate_comment_reply");
    expect(row?.deliverAfter).not.toBeNull();
  });

  it("never notifies the author about their own comment", async () => {
    const topicId = await createTopic();
    expect((await comment(topicId, { visitorId: "v-self" }, { clerkId: AUTHOR })).status).toBe(201);
    expect(await notificationsFor(await userIdFor(AUTHOR), "debate_topic_comment")).toHaveLength(0);
  });
});

describe("Debate Now comment reactions", () => {
  it("notifies a comment's author at most once per visitor, however often they toggle", async () => {
    const topicId = await createTopic();
    const posted = await comment(topicId, { visitorId: "v-comment-author" }, { clerkId: COMMENTER });
    expect(posted.status).toBe(201);
    const commenterId = await userIdFor(COMMENTER);
    const react = (reaction: "like" | "dislike") =>
      request(app).post(`/api/public/debate-topics/${topicId}/comments/${posted.body.id}/reactions`).send({ visitorId: "v-reactor", reaction });

    expect((await react("like")).body.viewerReaction).toBe("like");
    const [first] = await notificationsFor(commenterId, "debate_comment_reaction");
    expect(first?.deliverAfter).not.toBeNull();
    expect(pushMock.notifyUserPersisted).not.toHaveBeenCalled();
    // Simulate the first one having been delivered, so coalescing isn't
    // what's suppressing the rest.
    await db.update(notificationsTable).set({ deliverAfter: null }).where(eq(notificationsTable.targetUserId, commenterId));

    expect((await react("like")).body.viewerReaction).toBeNull(); // un-like
    expect((await react("like")).body).toMatchObject({ viewerReaction: "like", likeCount: 1 });
    expect((await react("dislike")).body).toMatchObject({ viewerReaction: "dislike", likeCount: 0, dislikeCount: 1 });
    expect((await react("like")).body).toMatchObject({ viewerReaction: "like", likeCount: 1, dislikeCount: 0 });

    expect(await notificationsFor(commenterId, "debate_comment_reaction")).toHaveLength(1);

    // An un-reacted row counts as neither and reads back as no reaction.
    await react("like");
    const page = await request(app).get(`/api/public/debate-topics/${topicId}`).query({ visitorId: "v-reactor" });
    const c = page.body.comments.find((x: any) => x.id === posted.body.id);
    expect(c).toMatchObject({ likeCount: 0, dislikeCount: 0, viewerReaction: null });
  });
});

describe("Debate Now anonymous comment cap", () => {
  it("can't be bypassed by rotating visitorId from one network", async () => {
    const limit = anonymousCommentLimit();
    if (limit === null) return; // cap disabled in this environment
    const topicId = await createTopic();

    for (let i = 0; i < limit * 3; i++) {
      expect((await comment(topicId, { visitorId: `rotating-${i}` }, { ip: "203.0.113.7" })).status).toBe(201);
    }
    const blocked = await comment(topicId, { visitorId: "rotating-fresh" }, { ip: "203.0.113.7" });
    expect(blocked.status).toBe(403);
    expect(blocked.body.code).toBe("comment_limit_reached");

    // A different network isn't affected.
    expect((await comment(topicId, { visitorId: "someone-else" }, { ip: "198.51.100.9" })).status).toBe(201);
    // Signed-in commenters and the topic's author stay exempt.
    expect((await comment(topicId, { visitorId: "signed-in" }, { clerkId: COMMENTER, ip: "203.0.113.7" })).status).toBe(201);
    expect((await comment(topicId, { visitorId: "author" }, { clerkId: AUTHOR, ip: "203.0.113.7" })).status).toBe(201);
  });

  it("groups IPv6 addresses by /56", async () => {
    const limit = anonymousCommentLimit();
    if (limit === null) return;
    const topicId = await createTopic();

    // 2001:db8:abcd:12xx::/56 — only the 4th group's low byte varies.
    const hex = (n: number) => n.toString(16).padStart(2, "0");
    for (let i = 0; i < limit * 3; i++) {
      expect((await comment(topicId, { visitorId: `v6-${i}` }, { ip: `2001:db8:abcd:12${hex(i)}::${i + 1}` })).status).toBe(201);
    }
    expect((await comment(topicId, { visitorId: "v6-fresh" }, { ip: "2001:db8:abcd:12ff::1" })).status).toBe(403);
    expect((await comment(topicId, { visitorId: "v6-other" }, { ip: "2001:db8:abcd:1300::1" })).status).toBe(201);
  });
});

describe("PATCH /public/debate-topics/:id/handle", () => {
  it("refuses reserved names with a `reserved` code, and still accepts ordinary ones", async () => {
    const topicId = await createTopic();
    // TopicAuthor mirrors the "Topic Author" badge this thread shows.
    for (const handle of ["OriginalPoster", "TopicAuthor", "TheTopicAuthor1", "Author", "Admin42", "BlindWhisperTeam", "Moderator", "Staff"]) {
      const res = await request(app).patch(`/api/public/debate-topics/${topicId}/handle`).send({ visitorId: "v-rename", handle });
      expect(res.status, handle).toBe(400);
      expect(res.body.code, handle).toBe("reserved");
    }

    const invalid = await request(app).patch(`/api/public/debate-topics/${topicId}/handle`).send({ visitorId: "v-rename", handle: "no spaces" });
    expect(invalid.body.code).toBe("invalid");

    const ok = await request(app).patch(`/api/public/debate-topics/${topicId}/handle`).send({ visitorId: "v-rename", handle: "QuietRiver123" });
    expect(ok.status).toBe(200);
    expect(ok.body.handle).toBe("QuietRiver123");
  });
});
