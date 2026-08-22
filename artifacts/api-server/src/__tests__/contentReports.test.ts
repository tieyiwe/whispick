import { describe, it, expect, afterEach } from "vitest";
import request from "supertest";
import app from "../app";
import { TEST_USER_HEADER } from "./setup";
import { db, notificationsTable, contentReportsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";

const ADMIN_CLERK_ID = "clerk_report_admin";
const ADMIN_EMAIL = `${ADMIN_CLERK_ID}@blindwhisper.com`;

function asUser(userId: string) {
  return { [TEST_USER_HEADER]: userId };
}

async function asAdmin() {
  process.env.ADMIN_EMAILS = ADMIN_EMAIL;
  await request(app).get("/api/user/profile").set(asUser(ADMIN_CLERK_ID));
  return asUser(ADMIN_CLERK_ID);
}

afterEach(() => {
  delete process.env.ADMIN_EMAILS;
});

// createDebateTopicLimiter (10/hour) and reportContentLimiter (20/hour) are
// keyed by clerk userId in IN-MEMORY express-rate-limit state that the
// afterEach DB truncate never resets — the same trap textWhisps.test.ts's
// setupFreshSenderAndVerifiedRecipient() exists for. Every test mints fresh
// author/reporter ids so no test can exhaust a budget the others depend on.
function freshClerkId(prefix: string): string {
  return `clerk_report_${prefix}_${randomUUID()}`;
}

async function createTopic(authorClerkId: string, text = "Is pineapple on pizza defensible?") {
  const res = await request(app).post("/api/debate-topics").set(asUser(authorClerkId)).send({ topicText: text });
  expect(res.status).toBe(201);
  return res.body as { id: string };
}

async function createComment(topicId: string, opts: { signedInAs?: string } = {}) {
  let req = request(app).post(`/api/public/debate-topics/${topicId}/comments`);
  if (opts.signedInAs) req = req.set(asUser(opts.signedInAs));
  const res = await req.send({ commentText: "Hot take incoming.", visitorId: `visitor-${randomUUID()}` });
  expect(res.status).toBe(201);
  return res.body as { id: string };
}

async function fileReport(reporterClerkId: string, contentType: string, contentId: string, overrides: Record<string, unknown> = {}) {
  return request(app)
    .post("/api/content-reports")
    .set(asUser(reporterClerkId))
    .send({ contentType, contentId, reason: "harassment", ...overrides });
}

// The internal DB id (not clerk id) a report's reporterUserId stores.
async function dbUserId(clerkId: string): Promise<string> {
  const profile = await request(app).get("/api/user/profile").set(asUser(clerkId));
  return profile.body.id;
}

describe("POST /content-reports", () => {
  it("requires authentication", async () => {
    const topic = await createTopic(freshClerkId("author"));
    const res = await request(app)
      .post("/api/content-reports")
      .send({ contentType: "debate_topic", contentId: topic.id, reason: "harassment" });
    expect(res.status).toBe(401);
  });

  it("files a report against a topic with reason-derived priority", async () => {
    const topic = await createTopic(freshClerkId("author"));
    const res = await fileReport(freshClerkId("reporter"), "debate_topic", topic.id, { reason: "child_safety", detail: "This looks very wrong." });
    expect(res.status).toBe(201);

    const row = await db.select().from(contentReportsTable).where(eq(contentReportsTable.id, res.body.id)).then((r) => r[0]);
    expect(row.priority).toBe("critical");
    expect(row.status).toBe("open");
    expect(row.debateTopicId).toBe(topic.id);
    expect(row.detail).toBe("This looks very wrong.");
  });

  it("maps lower-severity reasons to lower priorities", async () => {
    const topic = await createTopic(freshClerkId("author"));
    const res = await fileReport(freshClerkId("reporter"), "debate_topic", topic.id, { reason: "spam_or_scam" });
    expect(res.status).toBe(201);
    const row = await db.select().from(contentReportsTable).where(eq(contentReportsTable.id, res.body.id)).then((r) => r[0]);
    expect(row.priority).toBe("low");
  });

  it("rejects an unknown reason and an over-limit detail", async () => {
    const topic = await createTopic(freshClerkId("author"));
    const reporter = freshClerkId("reporter");
    const badReason = await fileReport(reporter, "debate_topic", topic.id, { reason: "i_just_dislike_it" });
    expect(badReason.status).toBe(400);

    const words = Array.from({ length: 301 }, (_, i) => `word${i}`).join(" ");
    const tooLong = await fileReport(reporter, "debate_topic", topic.id, { detail: words });
    expect(tooLong.status).toBe(400);
  });

  it("accepts a detail of exactly 300 words", async () => {
    const topic = await createTopic(freshClerkId("author"));
    const words = Array.from({ length: 300 }, (_, i) => `w${i}`).join(" ");
    const res = await fileReport(freshClerkId("reporter"), "debate_topic", topic.id, { detail: words });
    expect(res.status).toBe(201);
  });

  it("404s for a nonexistent topic and for an author-retracted one", async () => {
    const reporter = freshClerkId("reporter");
    const missing = await fileReport(reporter, "debate_topic", "no-such-topic");
    expect(missing.status).toBe(404);

    const author = freshClerkId("author");
    const topic = await createTopic(author);
    await request(app).delete(`/api/debate-topics/${topic.id}`).set(asUser(author));
    const retracted = await fileReport(reporter, "debate_topic", topic.id);
    expect(retracted.status).toBe(404);
  });

  it("rejects a duplicate open report on the same content from the same reporter", async () => {
    const topic = await createTopic(freshClerkId("author"));
    const reporter = freshClerkId("reporter");
    const first = await fileReport(reporter, "debate_topic", topic.id);
    expect(first.status).toBe(201);
    const second = await fileReport(reporter, "debate_topic", topic.id);
    expect(second.status).toBe(409);
    // A different reporter is not blocked by the first one's open report.
    const other = await fileReport(freshClerkId("reporter"), "debate_topic", topic.id);
    expect(other.status).toBe(201);
  });

  it("reports a comment via debate_topic_comment", async () => {
    const topic = await createTopic(freshClerkId("author"));
    const comment = await createComment(topic.id);
    const res = await fileReport(freshClerkId("reporter"), "debate_topic_comment", comment.id, { reason: "sexual_content" });
    expect(res.status).toBe(201);
    const row = await db.select().from(contentReportsTable).where(eq(contentReportsTable.id, res.body.id)).then((r) => r[0]);
    expect(row.debateTopicCommentId).toBe(comment.id);
    expect(row.priority).toBe("high");
  });
});

describe("Admin: content report queue", () => {
  it("is admin-only", async () => {
    const res = await request(app).get("/api/admin/content-reports").set(asUser(freshClerkId("nonadmin")));
    expect(res.status).toBe(403);
  });

  it("orders by priority (critical first) then oldest-first, and reports the triage summary", async () => {
    const adminHeaders = await asAdmin();
    const author = freshClerkId("author");
    const reporter = freshClerkId("reporter");
    const t1 = await createTopic(author, "Low priority target");
    const t2 = await createTopic(author, "Critical target");
    const t3 = await createTopic(author, "Medium target");
    await fileReport(reporter, "debate_topic", t1.id, { reason: "spam_or_scam" });
    await fileReport(reporter, "debate_topic", t2.id, { reason: "threat_or_violence" });
    await fileReport(reporter, "debate_topic", t3.id, { reason: "inappropriate" });

    const res = await request(app).get("/api/admin/content-reports").set(adminHeaders);
    expect(res.status).toBe(200);
    expect(res.body.items.map((r: any) => r.priority)).toEqual(["critical", "medium", "low"]);
    expect(res.body.openByPriority).toEqual({ critical: 1, high: 0, medium: 1, low: 1 });
    // Joined display fields are present.
    expect(res.body.items[0].debateTopicText).toBe("Critical target");
    expect(res.body.items[0].reporterEmail).toContain(reporter);
  });

  it("filters by status, priority, and reason", async () => {
    const adminHeaders = await asAdmin();
    const author = freshClerkId("author");
    const reporter = freshClerkId("reporter");
    const t1 = await createTopic(author);
    const t2 = await createTopic(author, "Second topic");
    await fileReport(reporter, "debate_topic", t1.id, { reason: "hate_speech" });
    await fileReport(reporter, "debate_topic", t2.id, { reason: "other" });

    const high = await request(app).get("/api/admin/content-reports?priority=high").set(adminHeaders);
    expect(high.body.items).toHaveLength(1);
    expect(high.body.items[0].reason).toBe("hate_speech");

    const byReason = await request(app).get("/api/admin/content-reports?reason=other").set(adminHeaders);
    expect(byReason.body.items).toHaveLength(1);

    const resolved = await request(app).get("/api/admin/content-reports?status=resolved").set(adminHeaders);
    expect(resolved.body.items).toHaveLength(0);
  });
});

describe("Admin: report review tool (PATCH)", () => {
  it("re-triages priority, claims into review, and keeps notes", async () => {
    const adminHeaders = await asAdmin();
    const topic = await createTopic(freshClerkId("author"));
    const filed = await fileReport(freshClerkId("reporter"), "debate_topic", topic.id, { reason: "spam_or_scam" });

    const res = await request(app)
      .patch(`/api/admin/content-reports/${filed.body.id}`)
      .set(adminHeaders)
      .send({ priority: "critical", status: "in_review", adminNotes: "Detail mentions a real threat — escalated." });
    expect(res.status).toBe(200);
    expect(res.body.priority).toBe("critical");
    expect(res.body.status).toBe("in_review");
    expect(res.body.adminNotes).toContain("escalated");
  });

  it("cannot set status to resolved directly, and 409s once resolved", async () => {
    const adminHeaders = await asAdmin();
    const topic = await createTopic(freshClerkId("author"));
    const filed = await fileReport(freshClerkId("reporter"), "debate_topic", topic.id);

    const direct = await request(app)
      .patch(`/api/admin/content-reports/${filed.body.id}`)
      .set(adminHeaders)
      .send({ status: "resolved" });
    expect(direct.status).toBe(400);

    await request(app)
      .post(`/api/admin/content-reports/${filed.body.id}/resolve`)
      .set(adminHeaders)
      .send({ resolution: "no_violation" });
    const after = await request(app)
      .patch(`/api/admin/content-reports/${filed.body.id}`)
      .set(adminHeaders)
      .send({ priority: "low" });
    expect(after.status).toBe(409);
  });
});

describe("Admin: resolving a report", () => {
  it("'removed' takes the topic down from public reads and notifies the reporter", async () => {
    const adminHeaders = await asAdmin();
    const reporter = freshClerkId("reporter");
    const topic = await createTopic(freshClerkId("author"), "This one crosses the line");
    const filed = await fileReport(reporter, "debate_topic", topic.id, { reason: "hate_speech" });

    const res = await request(app)
      .post(`/api/admin/content-reports/${filed.body.id}/resolve`)
      .set(adminHeaders)
      .send({ resolution: "removed", replyToReporter: "You were right — it's gone." });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("resolved");
    expect(res.body.resolution).toBe("removed");
    expect(res.body.adminReplyMessage).toBe("You were right — it's gone.");

    // Gone from the public detail read.
    const publicRead = await request(app).get(`/api/public/debate-topics/${topic.id}`);
    expect(publicRead.status).toBe(404);

    // Reporter got the custom reply as an in-app notification.
    const reporterId = await dbUserId(reporter);
    const notifs = await db.select().from(notificationsTable).where(eq(notificationsTable.targetUserId, reporterId));
    expect(notifs.some((n) => n.kind === "report_update" && n.body === "You were right — it's gone.")).toBe(true);
  });

  it("'no_violation' leaves content up and sends the default reply when none is written", async () => {
    const adminHeaders = await asAdmin();
    const reporter = freshClerkId("reporter");
    const topic = await createTopic(freshClerkId("author"), "Perfectly fine take");
    const filed = await fileReport(reporter, "debate_topic", topic.id);

    const res = await request(app)
      .post(`/api/admin/content-reports/${filed.body.id}/resolve`)
      .set(adminHeaders)
      .send({ resolution: "no_violation" });
    expect(res.status).toBe(200);
    expect(res.body.resolution).toBe("no_violation");
    // Default template mentions it doesn't violate the guidelines.
    expect(res.body.adminReplyMessage).toContain("doesn't violate");

    const publicRead = await request(app).get(`/api/public/debate-topics/${topic.id}`);
    expect(publicRead.status).toBe(200);

    const reporterId = await dbUserId(reporter);
    const notifs = await db.select().from(notificationsTable).where(eq(notificationsTable.targetUserId, reporterId));
    expect(notifs.some((n) => n.kind === "report_update")).toBe(true);
  });

  it("warns the topic author when asked, recording authorWarnedAt", async () => {
    const adminHeaders = await asAdmin();
    const author = freshClerkId("author");
    const topic = await createTopic(author);
    const filed = await fileReport(freshClerkId("reporter"), "debate_topic", topic.id);

    const res = await request(app)
      .post(`/api/admin/content-reports/${filed.body.id}/resolve`)
      .set(adminHeaders)
      .send({ resolution: "removed", warnAuthor: "This topic broke our harassment rules." });
    expect(res.status).toBe(200);
    expect(res.body.authorWarned).toBe(true);
    expect(res.body.authorWarnedAt).not.toBeNull();

    const authorId = await dbUserId(author);
    const notifs = await db.select().from(notificationsTable).where(eq(notificationsTable.targetUserId, authorId));
    const warning = notifs.find((n) => n.kind === "moderation_warning");
    expect(warning).toBeDefined();
    expect(warning!.body).toContain("This topic broke our harassment rules.");
    expect(warning!.url).toBe("/community-guidelines");
  });

  it("cannot warn an anonymous no-account comment author, and says so", async () => {
    const adminHeaders = await asAdmin();
    const topic = await createTopic(freshClerkId("author"));
    const comment = await createComment(topic.id); // anonymous — no signedInAs
    const filed = await fileReport(freshClerkId("reporter"), "debate_topic_comment", comment.id);

    const res = await request(app)
      .post(`/api/admin/content-reports/${filed.body.id}/resolve`)
      .set(adminHeaders)
      .send({ resolution: "removed", warnAuthor: "Warning that can't be delivered" });
    expect(res.status).toBe(200);
    expect(res.body.authorWarned).toBe(false);
    expect(res.body.authorWarnedAt).toBeNull();
  });

  it("removing a reported comment hides it from the public thread", async () => {
    const adminHeaders = await asAdmin();
    const author = freshClerkId("author");
    const topic = await createTopic(author);
    const comment = await createComment(topic.id, { signedInAs: author });
    const filed = await fileReport(freshClerkId("reporter"), "debate_topic_comment", comment.id);

    await request(app)
      .post(`/api/admin/content-reports/${filed.body.id}/resolve`)
      .set(adminHeaders)
      .send({ resolution: "removed" });

    const detail = await request(app).get(`/api/public/debate-topics/${topic.id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.comments.some((c: any) => c.id === comment.id)).toBe(false);
  });

  it("409s on double-resolve", async () => {
    const adminHeaders = await asAdmin();
    const topic = await createTopic(freshClerkId("author"));
    const filed = await fileReport(freshClerkId("reporter"), "debate_topic", topic.id);

    await request(app).post(`/api/admin/content-reports/${filed.body.id}/resolve`).set(adminHeaders).send({ resolution: "no_violation" });
    const again = await request(app).post(`/api/admin/content-reports/${filed.body.id}/resolve`).set(adminHeaders).send({ resolution: "removed" });
    expect(again.status).toBe(409);
  });
});
