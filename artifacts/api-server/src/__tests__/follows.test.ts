import { describe, it, expect } from "vitest";
import request from "supertest";
import app from "../app";
import { TEST_USER_HEADER } from "./setup";

function asUser(userId: string) {
  return { [TEST_USER_HEADER]: userId };
}

async function createTopic(userId: string, overrides: Record<string, unknown> = {}) {
  return request(app)
    .post("/api/debate-topics")
    .set(asUser(userId))
    .send({ topicText: "Is honesty always the best policy?", ...overrides });
}

describe("POST /api/debate-topics — Whisperer handle byline", () => {
  it("assigns a persistent, followable handle to the author", async () => {
    const res = await createTopic("clerk_follow_author_handle");
    expect(res.status).toBe(201);
    expect(typeof res.body.authorHandle).toBe("string");
    expect(res.body.authorHandle.length).toBeGreaterThan(0);
  });

  it("the same author reuses the same handle across topics", async () => {
    const first = await createTopic("clerk_follow_author_stable");
    const second = await createTopic("clerk_follow_author_stable", { topicText: "A second topic" });
    expect(first.body.authorHandle).toBe(second.body.authorHandle);
  });
});

describe("POST /api/follows", () => {
  it("requires auth", async () => {
    const res = await request(app).post("/api/follows").send({ handle: "SomeHandle1" });
    expect(res.status).toBe(401);
  });

  it("404s for an unknown handle", async () => {
    const res = await request(app).post("/api/follows").set(asUser("clerk_follow_seeker_1")).send({ handle: "NoSuchHandleAtAll999" });
    expect(res.status).toBe(404);
  });

  it("rejects following yourself", async () => {
    const topic = await createTopic("clerk_follow_self");
    const res = await request(app).post("/api/follows").set(asUser("clerk_follow_self")).send({ handle: topic.body.authorHandle });
    expect(res.status).toBe(400);
  });

  it("toggles following on then off, updating followerCount both times", async () => {
    const topic = await createTopic("clerk_follow_target_1");
    const handle = topic.body.authorHandle;

    const followRes = await request(app).post("/api/follows").set(asUser("clerk_follow_follower_1")).send({ handle });
    expect(followRes.status).toBe(200);
    expect(followRes.body.following).toBe(true);
    expect(followRes.body.followerCount).toBeGreaterThanOrEqual(1);

    const unfollowRes = await request(app).post("/api/follows").set(asUser("clerk_follow_follower_1")).send({ handle });
    expect(unfollowRes.status).toBe(200);
    expect(unfollowRes.body.following).toBe(false);
  });
});

describe("GET /api/follows/stats", () => {
  it("requires auth", async () => {
    const res = await request(app).get("/api/follows/stats");
    expect(res.status).toBe(401);
  });

  it("reflects a fresh follow", async () => {
    const topic = await createTopic("clerk_follow_target_2");
    await request(app).post("/api/follows").set(asUser("clerk_follow_follower_2")).send({ handle: topic.body.authorHandle });

    const followerStats = await request(app).get("/api/follows/stats").set(asUser("clerk_follow_target_2"));
    expect(followerStats.body.followerCount).toBeGreaterThanOrEqual(1);

    const followingStats = await request(app).get("/api/follows/stats").set(asUser("clerk_follow_follower_2"));
    expect(followingStats.body.followingCount).toBeGreaterThanOrEqual(1);
  });
});

describe("GET /api/debate-topics/following-feed", () => {
  it("requires auth", async () => {
    const res = await request(app).get("/api/debate-topics/following-feed");
    expect(res.status).toBe(401);
  });

  it("only includes topics from followed accounts", async () => {
    const followedTopic = await createTopic("clerk_follow_feed_followed");
    const notFollowedTopic = await createTopic("clerk_follow_feed_not_followed");

    await request(app).post("/api/follows").set(asUser("clerk_follow_feed_viewer")).send({ handle: followedTopic.body.authorHandle });

    const res = await request(app).get("/api/debate-topics/following-feed").set(asUser("clerk_follow_feed_viewer"));
    expect(res.status).toBe(200);
    const ids = res.body.items.map((t: any) => t.id);
    expect(ids).toContain(followedTopic.body.id);
    expect(ids).not.toContain(notFollowedTopic.body.id);
  });

  it("returns an empty feed when following no one", async () => {
    const res = await request(app).get("/api/debate-topics/following-feed").set(asUser("clerk_follow_feed_lonely"));
    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([]);
  });
});

describe("GET /api/debate-topics/my-stats", () => {
  it("requires auth", async () => {
    const res = await request(app).get("/api/debate-topics/my-stats");
    expect(res.status).toBe(401);
  });

  it("counts topics posted and comments received", async () => {
    const author = "clerk_follow_stats_author";
    const topic = await createTopic(author);

    await request(app)
      .post(`/api/public/debate-topics/${topic.body.id}/comments`)
      .send({ commentText: "Interesting take.", visitorId: "visitor_stats_1" });

    const stats = await request(app).get("/api/debate-topics/my-stats").set(asUser(author));
    expect(stats.status).toBe(200);
    expect(stats.body.topicsPosted).toBeGreaterThanOrEqual(1);
    expect(stats.body.commentsReceived).toBeGreaterThanOrEqual(1);
  });
});

describe("GET /api/public/debate-topics/:id — comment identity", () => {
  it("a signed-in commenter's comment shows their persistent handle and is followable", async () => {
    const topic = await createTopic("clerk_follow_comment_topic_author");
    const commenter = "clerk_follow_comment_commenter";

    await request(app)
      .post(`/api/public/debate-topics/${topic.body.id}/comments`)
      .set(asUser(commenter))
      .send({ commentText: "Well argued.", visitorId: "visitor_comment_identity_1" });

    const viewerRes = await request(app).get(`/api/public/debate-topics/${topic.body.id}`).set(asUser("clerk_follow_comment_viewer"));
    expect(viewerRes.status).toBe(200);
    const comment = viewerRes.body.comments[0];
    expect(typeof comment.handle).toBe("string");
    expect(comment.commentAuthorFollowed).toBe(false);

    await request(app).post("/api/follows").set(asUser("clerk_follow_comment_viewer")).send({ handle: comment.handle });

    const afterFollow = await request(app).get(`/api/public/debate-topics/${topic.body.id}`).set(asUser("clerk_follow_comment_viewer"));
    expect(afterFollow.body.comments[0].commentAuthorFollowed).toBe(true);
  });

  it("a purely anonymous commenter is not followable", async () => {
    const topic = await createTopic("clerk_follow_anon_topic_author");

    await request(app)
      .post(`/api/public/debate-topics/${topic.body.id}/comments`)
      .send({ commentText: "Anonymous take.", visitorId: "visitor_anon_identity_1" });

    const res = await request(app).get(`/api/public/debate-topics/${topic.body.id}`).set(asUser("clerk_follow_anon_viewer"));
    expect(res.body.comments[0].commentAuthorFollowed).toBeNull();
  });
});
