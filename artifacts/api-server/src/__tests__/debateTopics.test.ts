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
  return res;
}

describe("POST /api/debate-topics", () => {
  it("requires auth", async () => {
    const res = await request(app).post("/api/debate-topics").send({ topicText: "Anything?" });
    expect(res.status).toBe(401);
  });

  it("creates a topic and never returns the author's identity", async () => {
    const res = await createTopic("clerk_debate_author_1");
    expect(res.status).toBe(201);
    expect(res.body.topicText).toBe("Is honesty always the best policy?");
    expect(res.body.commentCount).toBe(0);
    expect(res.body).not.toHaveProperty("authorId");
  });

  it("rejects an empty topic", async () => {
    const res = await createTopic("clerk_debate_author_2", { topicText: "   " });
    expect(res.status).toBe(400);
  });

  it("rejects a topic longer than the title/subtitle-length cap", async () => {
    const res = await createTopic("clerk_debate_author_3", { topicText: "x".repeat(201) });
    expect(res.status).toBe(400);
  });

  it("accepts a topic right at the cap", async () => {
    const res = await createTopic("clerk_debate_author_4", { topicText: "x".repeat(200) });
    expect(res.status).toBe(201);
  });
});

describe("GET /api/public/debate-topics", () => {
  it("lists topics with a comment count and no author identity, no account required", async () => {
    const created = await createTopic("clerk_debate_feed_author");

    const res = await request(app).get("/api/public/debate-topics");
    expect(res.status).toBe(200);
    const item = res.body.items.find((t: any) => t.id === created.body.id);
    expect(item).toBeTruthy();
    expect(item.commentCount).toBe(0);
    expect(item).not.toHaveProperty("authorId");
  });
});

describe("GET /api/public/debate-topics/:id", () => {
  it("returns 404 for an unknown id", async () => {
    const res = await request(app).get("/api/public/debate-topics/does-not-exist");
    expect(res.status).toBe(404);
  });

  it("reports isOwnTopic true for the author, false for everyone else", async () => {
    const created = await createTopic("clerk_debate_owner_check");

    const ownerView = await request(app).get(`/api/public/debate-topics/${created.body.id}`).set(asUser("clerk_debate_owner_check"));
    expect(ownerView.body.isOwnTopic).toBe(true);

    const strangerView = await request(app).get(`/api/public/debate-topics/${created.body.id}`).set(asUser("clerk_debate_stranger"));
    expect(strangerView.body.isOwnTopic).toBe(false);

    const anonView = await request(app).get(`/api/public/debate-topics/${created.body.id}`);
    expect(anonView.body.isOwnTopic).toBe(false);
  });
});

describe("DELETE /api/debate-topics/:id (retraction)", () => {
  it("requires auth", async () => {
    const created = await createTopic("clerk_debate_retract_owner");
    const res = await request(app).delete(`/api/debate-topics/${created.body.id}`);
    expect(res.status).toBe(401);
  });

  it("only the author can retract it", async () => {
    const created = await createTopic("clerk_debate_retract_owner2");
    const res = await request(app).delete(`/api/debate-topics/${created.body.id}`).set(asUser("clerk_debate_not_the_author"));
    expect(res.status).toBe(404);
  });

  it("removes the topic from the public feed and detail lookup once retracted", async () => {
    const created = await createTopic("clerk_debate_retract_owner3");

    const del = await request(app).delete(`/api/debate-topics/${created.body.id}`).set(asUser("clerk_debate_retract_owner3"));
    expect(del.status).toBe(204);

    const detail = await request(app).get(`/api/public/debate-topics/${created.body.id}`);
    expect(detail.status).toBe(404);

    const feed = await request(app).get("/api/public/debate-topics");
    expect(feed.body.items.some((t: any) => t.id === created.body.id)).toBe(false);
  });
});

describe("POST /api/public/debate-topics/:id/comments", () => {
  it("returns 404 for an unknown topic", async () => {
    const res = await request(app)
      .post("/api/public/debate-topics/does-not-exist/comments")
      .send({ commentText: "hi", visitorId: "visitor-unknown-topic" });
    expect(res.status).toBe(404);
  });

  it("posts an anonymous comment and never returns the visitorId", async () => {
    const created = await createTopic("clerk_debate_comment_topic_author");

    const res = await request(app)
      .post(`/api/public/debate-topics/${created.body.id}/comments`)
      .send({ commentText: "Not always — sometimes kindness matters more.", visitorId: "visitor-anon-1" });

    expect(res.status).toBe(201);
    expect(res.body.commentText).toBe("Not always — sometimes kindness matters more.");
    expect(res.body.isPoster).toBe(false);
    expect(res.body).not.toHaveProperty("visitorId");
  });

  it("badges the topic's own signed-in author as isPoster without naming them", async () => {
    const created = await createTopic("clerk_debate_poster_check");

    const res = await request(app)
      .post(`/api/public/debate-topics/${created.body.id}/comments`)
      .set(asUser("clerk_debate_poster_check"))
      .send({ commentText: "My own take on this.", visitorId: "visitor-author-1" });

    expect(res.status).toBe(201);
    expect(res.body.isPoster).toBe(true);
    expect(res.body).not.toHaveProperty("authorId");
  });

  it("does not badge a signed-in commenter who is not the topic's author", async () => {
    const created = await createTopic("clerk_debate_not_poster_author");

    const res = await request(app)
      .post(`/api/public/debate-topics/${created.body.id}/comments`)
      .set(asUser("clerk_debate_someone_else"))
      .send({ commentText: "Just a visitor's opinion.", visitorId: "visitor-signedin-1" });

    expect(res.status).toBe(201);
    expect(res.body.isPoster).toBe(false);
  });

  it("only links a parentCommentId that belongs to the same topic", async () => {
    const topicOne = await createTopic("clerk_debate_thread_a");
    const topicTwo = await createTopic("clerk_debate_thread_b");

    const foreignComment = await request(app)
      .post(`/api/public/debate-topics/${topicTwo.body.id}/comments`)
      .send({ commentText: "From a different topic entirely.", visitorId: "visitor-foreign" });

    const reply = await request(app)
      .post(`/api/public/debate-topics/${topicOne.body.id}/comments`)
      .send({ commentText: "Replying, but citing the wrong topic's comment.", visitorId: "visitor-reply-cross-topic", parentCommentId: foreignComment.body.id });

    expect(reply.status).toBe(201);
    expect(reply.body.parentCommentId).toBeNull();
  });

  it("shows up in the topic detail's comment thread and comment count", async () => {
    const created = await createTopic("clerk_debate_thread_visible");

    await request(app)
      .post(`/api/public/debate-topics/${created.body.id}/comments`)
      .send({ commentText: "First take.", visitorId: "visitor-thread-1" });

    const detail = await request(app).get(`/api/public/debate-topics/${created.body.id}`);
    expect(detail.body.commentCount).toBe(1);
    expect(detail.body.comments).toHaveLength(1);
    expect(detail.body.comments[0].commentText).toBe("First take.");
  });

  it("rate-limits an anonymous visitor after the free comment allowance, but never a signed-in commenter", async () => {
    const created = await createTopic("clerk_debate_rate_limit_topic");
    const visitorId = "visitor-rate-limited-1";

    let lastStatus = 0;
    let lastBody: any = null;
    for (let i = 0; i < 4; i++) {
      const res = await request(app)
        .post(`/api/public/debate-topics/${created.body.id}/comments`)
        .send({ commentText: `Comment number ${i}`, visitorId });
      lastStatus = res.status;
      lastBody = res.body;
    }

    // Default ANONYMOUS_COMMENT_LIMIT is 3 per rolling 24h window (see
    // lib/plans.ts) — the 4th comment from the same anonymous visitor in
    // this same window should be refused.
    expect(lastStatus).toBe(403);
    expect(lastBody.code).toBe("comment_limit_reached");

    // A signed-in commenter is exempt entirely, even past that same count.
    const signedIn = await request(app)
      .post(`/api/public/debate-topics/${created.body.id}/comments`)
      .set(asUser("clerk_debate_rate_limit_signed_in"))
      .send({ commentText: "Signed in, so no limit applies to me.", visitorId: "visitor-signed-in-exempt" });
    expect(signedIn.status).toBe(201);
  });

  it("exempts the topic's own author from the anonymous rate limit even while posting many comments", async () => {
    const created = await createTopic("clerk_debate_author_exempt");

    let lastStatus = 0;
    for (let i = 0; i < 5; i++) {
      const res = await request(app)
        .post(`/api/public/debate-topics/${created.body.id}/comments`)
        .set(asUser("clerk_debate_author_exempt"))
        .send({ commentText: `Author comment ${i}`, visitorId: "visitor-author-exempt" });
      lastStatus = res.status;
    }
    expect(lastStatus).toBe(201);
  });
});

describe("Debate topic creation rate limiting", () => {
  it("caps how many topics a single signed-in user can post per hour", async () => {
    let lastStatus = 0;
    for (let i = 0; i < 11; i++) {
      const res = await createTopic("clerk_debate_burst_creator", { topicText: `Topic number ${i}?` });
      lastStatus = res.status;
    }
    expect(lastStatus).toBe(429);
  });
});
