import { describe, it, expect, afterEach } from "vitest";
import request from "supertest";
import app from "../app";
import { db, debateTopicsTable, debateAgentSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { TEST_USER_HEADER, anthropicMessagesCreateMock } from "./setup";
import { runDebateTopicAgentSweep } from "../lib/debateAgent";

const ADMIN_CLERK_ID = "clerk_debate_agent_admin";
const ADMIN_EMAIL = `${ADMIN_CLERK_ID}@blindwhisper.com`;

function asUser(userId: string) {
  return { [TEST_USER_HEADER]: userId };
}

async function asAdmin() {
  process.env.ADMIN_EMAILS = ADMIN_EMAIL;
  // Any authenticated request runs ensureUser, which promotes on match.
  await request(app).get("/api/user/profile").set(asUser(ADMIN_CLERK_ID));
  return asUser(ADMIN_CLERK_ID);
}

afterEach(() => {
  delete process.env.ADMIN_EMAILS;
});

async function getSettingsRow() {
  return db.select().from(debateAgentSettingsTable).where(eq(debateAgentSettingsTable.id, "singleton")).then((r) => r[0]);
}

describe("GET /api/admin/debate-agent/config", () => {
  it("rejects unauthenticated and non-admin requests", async () => {
    const unauth = await request(app).get("/api/admin/debate-agent/config");
    expect(unauth.status).toBe(401);

    const nonAdmin = await request(app).get("/api/admin/debate-agent/config").set(asUser("clerk_regular_user"));
    expect(nonAdmin.status).toBe(403);
  });

  it("lazily creates a default (disabled) row on first read", async () => {
    expect(await getSettingsRow()).toBeUndefined();

    const adminHeaders = await asAdmin();
    const res = await request(app).get("/api/admin/debate-agent/config").set(adminHeaders);

    expect(res.status).toBe(200);
    expect(res.body.enabled).toBe(false);
    expect(res.body.dailyPostCount).toBe(3);
    expect(Array.isArray(res.body.topics)).toBe(true);
    expect(res.body.topics.length).toBeGreaterThan(0);
    expect(await getSettingsRow()).toBeDefined();
  });
});

describe("PATCH /api/admin/debate-agent/config", () => {
  it("rejects an out-of-bounds dailyPostCount", async () => {
    const adminHeaders = await asAdmin();
    const tooHigh = await request(app).patch("/api/admin/debate-agent/config").set(adminHeaders).send({ dailyPostCount: 11 });
    expect(tooHigh.status).toBe(400);

    const tooLow = await request(app).patch("/api/admin/debate-agent/config").set(adminHeaders).send({ dailyPostCount: 0 });
    expect(tooLow.status).toBe(400);
  });

  it("rejects an empty topics array", async () => {
    const adminHeaders = await asAdmin();
    const res = await request(app).patch("/api/admin/debate-agent/config").set(adminHeaders).send({ topics: [] });
    expect(res.status).toBe(400);
  });

  it("persists enabled/dailyPostCount/topics and records who changed it", async () => {
    const adminHeaders = await asAdmin();
    const profile = await request(app).get("/api/user/profile").set(adminHeaders);

    const res = await request(app)
      .patch("/api/admin/debate-agent/config")
      .set(adminHeaders)
      .send({ enabled: true, dailyPostCount: 5, topics: ["Sports", "Technology"] });

    expect(res.status).toBe(200);
    expect(res.body.enabled).toBe(true);
    expect(res.body.dailyPostCount).toBe(5);
    expect(res.body.topics).toEqual(["Sports", "Technology"]);
    expect(res.body.updatedByAdminId).toBe(profile.body.id);
    expect(res.body.updatedAt).not.toBeNull();

    const row = await getSettingsRow();
    expect(row?.enabled).toBe(true);
    expect(row?.topics).toEqual(["Sports", "Technology"]);
  });
});

describe("POST /api/admin/debate-agent/run-now", () => {
  it("posts AI-generated topics under postedBy='admin_agent' even while the feature defaults to disabled, and they surface anonymously in the public feed", async () => {
    const adminHeaders = await asAdmin();
    // Config has never been touched — the underlying row is still
    // disabled=false, same as a fresh install. run-now must still work.
    anthropicMessagesCreateMock.mockResolvedValue({
      content: [{ type: "text", text: "Is remote work actually better for productivity?" }],
    });

    const res = await request(app).post("/api/admin/debate-agent/run-now").set(adminHeaders);
    expect(res.status).toBe(200);
    expect(res.body.posted).toBeGreaterThan(0);

    const settings = await getSettingsRow();
    expect(settings?.enabled).toBe(false);

    const rows = await db.select().from(debateTopicsTable);
    expect(rows.length).toBe(res.body.posted);
    for (const row of rows) {
      expect(row.postedBy).toBe("admin_agent");
      expect(row.topicText).toBe("Is remote work actually better for productivity?");
    }

    const feed = await request(app).get("/api/public/debate-topics");
    expect(feed.status).toBe(200);
    expect(feed.body.items.length).toBe(res.body.posted);
    for (const item of feed.body.items) {
      // A debate topic posted by the agent reads exactly like any other
      // public topic: an anonymous byline, no postedBy/authorId leak.
      expect(item.postedBy).toBeUndefined();
      expect(item.authorId).toBeUndefined();
      expect(typeof item.authorHandle).toBe("string");
      expect(item.authorHandle.length).toBeGreaterThan(0);
    }
  });

  it("no-ops without inserting anything if the model returns nothing usable, without erroring", async () => {
    const adminHeaders = await asAdmin();
    anthropicMessagesCreateMock.mockResolvedValue({ content: [{ type: "text", text: "" }] });

    const res = await request(app).post("/api/admin/debate-agent/run-now").set(adminHeaders);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ posted: 0, skipped: 0 });
  });
});

describe("POST /api/admin/debate-agent/post", () => {
  it("publishes a manually composed topic under postedBy='admin'", async () => {
    const adminHeaders = await asAdmin();
    const res = await request(app)
      .post("/api/admin/debate-agent/post")
      .set(adminHeaders)
      .send({ topicText: "Is capitalism still working for the middle class?" });

    expect(res.status).toBe(201);
    expect(res.body.id).toBeDefined();

    const row = await db
      .select()
      .from(debateTopicsTable)
      .where(eq(debateTopicsTable.id, res.body.id))
      .then((r) => r[0]);
    expect(row?.postedBy).toBe("admin");
    expect(row?.topicText).toBe("Is capitalism still working for the middle class?");
  });

  it("rejects empty or over-length text", async () => {
    const adminHeaders = await asAdmin();
    const empty = await request(app).post("/api/admin/debate-agent/post").set(adminHeaders).send({ topicText: "   " });
    expect(empty.status).toBe(400);

    const tooLong = await request(app)
      .post("/api/admin/debate-agent/post")
      .set(adminHeaders)
      .send({ topicText: "x".repeat(201) });
    expect(tooLong.status).toBe(400);
  });

  it("shows an admin-composed topic in the public feed exactly like any other topic", async () => {
    const adminHeaders = await asAdmin();
    await request(app).post("/api/admin/debate-agent/post").set(adminHeaders).send({ topicText: "Admin composed topic" });

    const feed = await request(app).get("/api/public/debate-topics");
    const item = feed.body.items.find((i: any) => i.topicText === "Admin composed topic");
    expect(item).toBeDefined();
    expect(item.postedBy).toBeUndefined();
    expect(item.authorId).toBeUndefined();
    expect(typeof item.authorHandle).toBe("string");
  });
});

describe("runDebateTopicAgentSweep — unforced (scheduled) path", () => {
  it("no-ops while the feature is disabled, without calling Claude", async () => {
    anthropicMessagesCreateMock.mockResolvedValue({ content: [{ type: "text", text: "Should X happen?" }] });

    const result = await runDebateTopicAgentSweep();

    expect(result).toEqual({ posted: 0, skipped: 0 });
    expect(anthropicMessagesCreateMock).not.toHaveBeenCalled();
    expect(await db.select().from(debateTopicsTable)).toHaveLength(0);
  });

  it("runs normally once an admin has enabled it", async () => {
    await db.insert(debateAgentSettingsTable).values({ id: "singleton", enabled: true, dailyPostCount: 1, topics: ["Sports"] });
    anthropicMessagesCreateMock.mockResolvedValue({ content: [{ type: "text", text: "Should college athletes be paid?" }] });

    const result = await runDebateTopicAgentSweep();

    expect(result.posted).toBe(1);
    const rows = await db.select().from(debateTopicsTable);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.postedBy).toBe("admin_agent");
  });
});

describe("runDebateTopicAgentSweep — dedupe", () => {
  it("does not post the same generated topic text twice within the dedupe window", async () => {
    await db.insert(debateAgentSettingsTable).values({ id: "singleton", enabled: true, dailyPostCount: 1, topics: ["Sports"] });
    anthropicMessagesCreateMock.mockResolvedValue({ content: [{ type: "text", text: "Should college athletes be paid?" }] });

    const first = await runDebateTopicAgentSweep();
    expect(first.posted).toBe(1);
    expect(first.skipped).toBe(0);

    const second = await runDebateTopicAgentSweep();
    expect(second.posted).toBe(0);
    expect(second.skipped).toBe(1);

    const rows = await db.select().from(debateTopicsTable).where(eq(debateTopicsTable.topicText, "Should college athletes be paid?"));
    expect(rows).toHaveLength(1);
  });
});

describe("runDebateTopicAgentSweep — run status tracking", () => {
  it("flags a run as low-credit when generation fails with a credit-balance-shaped message", async () => {
    await db.insert(debateAgentSettingsTable).values({ id: "singleton", enabled: true, dailyPostCount: 1, topics: ["Sports"] });
    anthropicMessagesCreateMock.mockRejectedValue(
      new Error("Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits."),
    );

    await runDebateTopicAgentSweep();

    const row = await getSettingsRow();
    expect(row?.lastRunOk).toBe(false);
    expect(row?.lowCreditSuspected).toBe(true);
    expect(row?.consecutiveFailures).toBe(1);
  });

  it("resets consecutiveFailures once a run succeeds again", async () => {
    await db.insert(debateAgentSettingsTable).values({ id: "singleton", enabled: true, dailyPostCount: 1, topics: ["Sports"] });
    anthropicMessagesCreateMock.mockRejectedValue(new Error("upstream timeout"));
    await runDebateTopicAgentSweep();
    expect((await getSettingsRow())?.consecutiveFailures).toBe(1);

    anthropicMessagesCreateMock.mockResolvedValue({ content: [{ type: "text", text: "A fresh topic entirely." }] });
    await runDebateTopicAgentSweep();

    const row = await getSettingsRow();
    expect(row?.lastRunOk).toBe(true);
    expect(row?.consecutiveFailures).toBe(0);
  });
});
