import { describe, it, expect, vi, afterEach } from "vitest";
import request from "supertest";
import app from "../app";
import { db, whispsTable, circleAgentSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { TEST_USER_HEADER, anthropicMessagesCreateMock } from "./setup";
import { runCircleContentAgentSweep } from "../lib/circleContentAgent";

const ADMIN_CLERK_ID = "clerk_circle_agent_admin";
const ADMIN_EMAIL = `${ADMIN_CLERK_ID}@blindwhisper.com`;

const GOOD_URL = "https://youtu.be/goodVideo12";
const GOOD_URL_2 = "https://youtu.be/goodVideo34";

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
  vi.unstubAllGlobals();
});

async function getSettingsRow() {
  return db.select().from(circleAgentSettingsTable).where(eq(circleAgentSettingsTable.id, "singleton")).then((r) => r[0]);
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

// Same fetch-stubbing pattern suggestionAgent.test.ts uses: resolveVideoMeta
// tries oEmbed first, so stubbing the YouTube oEmbed endpoint is enough to
// make a youtu.be URL resolve successfully without any real network call.
function stubYoutubeOembed() {
  const fetchMock = vi.fn(async (input: any) => {
    const url = String(input);
    if (url.includes("youtube.com/oembed")) {
      return jsonResponse(200, { title: "A discovered video", thumbnail_url: "https://i.ytimg.com/vi/x/hqdefault.jpg", author_name: "Someone" });
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

// A URL that parses fine and points at an allowlisted host, but whose oEmbed/
// OpenGraph scrape never resolves to real content — used to exercise the
// "candidate looked plausible but resolveVideoMeta rejected it" skip path.
function stubYoutubeOembedNotFound() {
  const fetchMock = vi.fn(async (input: any) => {
    const url = String(input);
    if (url.includes("youtube.com/oembed")) {
      return jsonResponse(404, {});
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("GET /api/admin/circle-agent/config", () => {
  it("rejects unauthenticated and non-admin requests", async () => {
    const unauth = await request(app).get("/api/admin/circle-agent/config");
    expect(unauth.status).toBe(401);

    const nonAdmin = await request(app).get("/api/admin/circle-agent/config").set(asUser("clerk_regular_user"));
    expect(nonAdmin.status).toBe(403);
  });

  it("lazily creates a default (disabled) row on first read", async () => {
    expect(await getSettingsRow()).toBeUndefined();

    const adminHeaders = await asAdmin();
    const res = await request(app).get("/api/admin/circle-agent/config").set(adminHeaders);

    expect(res.status).toBe(200);
    expect(res.body.enabled).toBe(false);
    expect(res.body.dailyPostCount).toBe(3);
    expect(Array.isArray(res.body.topics)).toBe(true);
    expect(res.body.topics.length).toBeGreaterThan(0);
    expect(await getSettingsRow()).toBeDefined();
  });
});

describe("PATCH /api/admin/circle-agent/config", () => {
  it("rejects an out-of-bounds dailyPostCount", async () => {
    const adminHeaders = await asAdmin();
    const tooHigh = await request(app).patch("/api/admin/circle-agent/config").set(adminHeaders).send({ dailyPostCount: 11 });
    expect(tooHigh.status).toBe(400);

    const tooLow = await request(app).patch("/api/admin/circle-agent/config").set(adminHeaders).send({ dailyPostCount: 0 });
    expect(tooLow.status).toBe(400);
  });

  it("rejects an empty topics array", async () => {
    const adminHeaders = await asAdmin();
    const res = await request(app).patch("/api/admin/circle-agent/config").set(adminHeaders).send({ topics: [] });
    expect(res.status).toBe(400);
  });

  it("persists enabled/dailyPostCount/topics and records who changed it", async () => {
    const adminHeaders = await asAdmin();
    const profile = await request(app).get("/api/user/profile").set(adminHeaders);

    const res = await request(app)
      .patch("/api/admin/circle-agent/config")
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

describe("POST /api/admin/circle-agent/run-now", () => {
  it("posts an AI-discovered video under postedBy='admin_agent' even while the feature defaults to disabled, and it surfaces anonymously in the public feed", async () => {
    stubYoutubeOembed();
    const adminHeaders = await asAdmin();
    // Config has never been touched — the underlying row is still
    // disabled=false, same as a fresh install. run-now must still work.
    anthropicMessagesCreateMock.mockResolvedValue({
      content: [{ type: "text", text: `Check this out: ${GOOD_URL}` }],
    });

    const res = await request(app).post("/api/admin/circle-agent/run-now").set(adminHeaders);
    expect(res.status).toBe(200);
    expect(res.body.posted).toBeGreaterThan(0);

    const settings = await getSettingsRow();
    expect(settings?.enabled).toBe(false);

    const rows = await db.select().from(whispsTable);
    expect(rows.length).toBe(res.body.posted);
    for (const row of rows) {
      expect(row.postedBy).toBe("admin_agent");
      expect(row.deliveryMethod).toBe("circle_drop");
      expect(row.circleId).toBeNull();
      expect(row.status).toBe("delivered");
      expect(row.videoUrl).toBe(GOOD_URL);
      expect(row.videoTitle).toBe("A discovered video");
      expect(row.videoPlatform).toBe("youtube");
    }

    const feed = await request(app).get("/api/public/circle");
    expect(feed.status).toBe(200);
    expect(feed.body.items.length).toBe(res.body.posted);
    for (const item of feed.body.items) {
      // A video posted by the agent reads exactly like any other public
      // Circle Drop: no postedBy/senderId leak, same anti-enumeration
      // posture as every other public feed in this app.
      expect(item.postedBy).toBeUndefined();
      expect(item.senderId).toBeUndefined();
      expect(item.videoUrl).toBe(GOOD_URL);
    }
  });

  it("no-ops without inserting anything if the model returns nothing usable, without erroring", async () => {
    const adminHeaders = await asAdmin();
    anthropicMessagesCreateMock.mockResolvedValue({ content: [{ type: "text", text: "" }] });

    const res = await request(app).post("/api/admin/circle-agent/run-now").set(adminHeaders);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ posted: 0, skipped: 0 });
  });

  it("skips (doesn't crash) a candidate URL that resolveVideoMeta can't resolve", async () => {
    stubYoutubeOembedNotFound();
    const adminHeaders = await asAdmin();
    anthropicMessagesCreateMock.mockResolvedValue({ content: [{ type: "text", text: GOOD_URL }] });

    const res = await request(app).post("/api/admin/circle-agent/run-now").set(adminHeaders);
    expect(res.status).toBe(200);
    expect(res.body.posted).toBe(0);
    expect(res.body.skipped).toBeGreaterThan(0);
    expect(await db.select().from(whispsTable)).toHaveLength(0);
  });

  it("never reaches fetch() for a URL outside the platform allowlist", async () => {
    const fetchMock = vi.fn(async (input: any) => {
      throw new Error(`unexpected fetch: ${String(input)}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const adminHeaders = await asAdmin();
    anthropicMessagesCreateMock.mockResolvedValue({
      content: [{ type: "text", text: "https://evil.example.com/not-allowlisted" }],
    });

    const res = await request(app).post("/api/admin/circle-agent/run-now").set(adminHeaders);
    expect(res.status).toBe(200);
    expect(res.body.posted).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/admin/circle-agent/post", () => {
  it("publishes a manually chosen video URL under postedBy='admin_agent'", async () => {
    stubYoutubeOembed();
    const adminHeaders = await asAdmin();
    const res = await request(app).post("/api/admin/circle-agent/post").set(adminHeaders).send({ videoUrl: GOOD_URL });

    expect(res.status).toBe(201);
    expect(res.body.id).toBeDefined();

    const row = await db.select().from(whispsTable).where(eq(whispsTable.id, res.body.id)).then((r) => r[0]);
    expect(row?.postedBy).toBe("admin_agent");
    expect(row?.deliveryMethod).toBe("circle_drop");
    expect(row?.circleId).toBeNull();
    expect(row?.videoUrl).toBe(GOOD_URL);
  });

  it("rejects a malformed URL", async () => {
    const adminHeaders = await asAdmin();
    const res = await request(app).post("/api/admin/circle-agent/post").set(adminHeaders).send({ videoUrl: "not a url" });
    expect(res.status).toBe(400);
  });

  it("rejects a javascript: URL rather than treating it as a plain string", async () => {
    const adminHeaders = await asAdmin();
    const res = await request(app).post("/api/admin/circle-agent/post").set(adminHeaders).send({ videoUrl: "javascript:alert(1)" });
    expect(res.status).toBe(400);
  });

  it("rejects a URL from an unsupported platform with a clear 400, and inserts nothing", async () => {
    const adminHeaders = await asAdmin();
    const res = await request(app).post("/api/admin/circle-agent/post").set(adminHeaders).send({ videoUrl: "https://example.com/some-video" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
    expect(await db.select().from(whispsTable)).toHaveLength(0);
  });

  it("rejects a URL resolveVideoMeta can't scrape a preview for", async () => {
    stubYoutubeOembedNotFound();
    const adminHeaders = await asAdmin();
    const res = await request(app).post("/api/admin/circle-agent/post").set(adminHeaders).send({ videoUrl: GOOD_URL });
    expect(res.status).toBe(400);
    expect(await db.select().from(whispsTable)).toHaveLength(0);
  });

  it("shows a manually posted video in the public feed exactly like any other post", async () => {
    stubYoutubeOembed();
    const adminHeaders = await asAdmin();
    await request(app).post("/api/admin/circle-agent/post").set(adminHeaders).send({ videoUrl: GOOD_URL });

    const feed = await request(app).get("/api/public/circle");
    const item = feed.body.items.find((i: any) => i.videoUrl === GOOD_URL);
    expect(item).toBeDefined();
    expect(item.postedBy).toBeUndefined();
    expect(item.senderId).toBeUndefined();
  });
});

describe("runCircleContentAgentSweep — unforced (scheduled) path", () => {
  it("no-ops while the feature is disabled, without calling Claude", async () => {
    anthropicMessagesCreateMock.mockResolvedValue({ content: [{ type: "text", text: GOOD_URL }] });

    const result = await runCircleContentAgentSweep();

    expect(result).toEqual({ posted: 0, skipped: 0 });
    expect(anthropicMessagesCreateMock).not.toHaveBeenCalled();
    expect(await db.select().from(whispsTable)).toHaveLength(0);
  });

  it("runs normally once an admin has enabled it", async () => {
    stubYoutubeOembed();
    await db.insert(circleAgentSettingsTable).values({ id: "singleton", enabled: true, dailyPostCount: 1, topics: ["Sports"] });
    anthropicMessagesCreateMock.mockResolvedValue({ content: [{ type: "text", text: GOOD_URL }] });

    const result = await runCircleContentAgentSweep();

    expect(result.posted).toBe(1);
    const rows = await db.select().from(whispsTable);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.postedBy).toBe("admin_agent");
  });
});

describe("runCircleContentAgentSweep — dedupe", () => {
  it("does not re-post the same video URL within the dedupe window across sweeps", async () => {
    stubYoutubeOembed();
    await db.insert(circleAgentSettingsTable).values({ id: "singleton", enabled: true, dailyPostCount: 1, topics: ["Sports"] });
    anthropicMessagesCreateMock.mockResolvedValue({ content: [{ type: "text", text: GOOD_URL }] });

    const first = await runCircleContentAgentSweep();
    expect(first.posted).toBe(1);
    expect(first.skipped).toBe(0);

    const second = await runCircleContentAgentSweep();
    expect(second.posted).toBe(0);
    expect(second.skipped).toBe(1);

    const rows = await db.select().from(whispsTable).where(eq(whispsTable.videoUrl, GOOD_URL));
    expect(rows).toHaveLength(1);
  });

  it("dedupes within the same sweep when several topics surface the same URL", async () => {
    stubYoutubeOembed();
    await db.insert(circleAgentSettingsTable).values({ id: "singleton", enabled: true, dailyPostCount: 2, topics: ["Sports", "Comedy"] });
    anthropicMessagesCreateMock.mockResolvedValue({ content: [{ type: "text", text: GOOD_URL }] });

    const result = await runCircleContentAgentSweep();

    expect(result.posted).toBe(1);
    expect(result.skipped).toBe(1);
    expect(await db.select().from(whispsTable)).toHaveLength(1);
  });

  it("does not dedupe two genuinely different URLs", async () => {
    const fetchMock = vi.fn(async (input: any) => {
      const url = String(input);
      if (url.includes("youtube.com/oembed")) {
        return jsonResponse(200, { title: "A discovered video", thumbnail_url: "https://i.ytimg.com/vi/x/hqdefault.jpg" });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    await db.insert(circleAgentSettingsTable).values({ id: "singleton", enabled: true, dailyPostCount: 2, topics: ["Sports", "Comedy"] });
    anthropicMessagesCreateMock
      .mockResolvedValueOnce({ content: [{ type: "text", text: GOOD_URL }] })
      .mockResolvedValueOnce({ content: [{ type: "text", text: GOOD_URL_2 }] });

    const result = await runCircleContentAgentSweep();

    expect(result.posted).toBe(2);
    expect(await db.select().from(whispsTable)).toHaveLength(2);
  });
});

describe("runCircleContentAgentSweep — run status tracking", () => {
  it("flags a run as low-credit when every topic's search call fails with a credit-balance-shaped message", async () => {
    await db.insert(circleAgentSettingsTable).values({ id: "singleton", enabled: true, dailyPostCount: 1, topics: ["Sports"] });
    anthropicMessagesCreateMock.mockRejectedValue(
      new Error("Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits."),
    );

    await runCircleContentAgentSweep();

    const row = await getSettingsRow();
    expect(row?.lastRunOk).toBe(false);
    expect(row?.lowCreditSuspected).toBe(true);
    expect(row?.consecutiveFailures).toBe(1);
  });

  it("resets consecutiveFailures once a run succeeds again", async () => {
    await db.insert(circleAgentSettingsTable).values({ id: "singleton", enabled: true, dailyPostCount: 1, topics: ["Sports"] });
    anthropicMessagesCreateMock.mockRejectedValue(new Error("upstream timeout"));
    await runCircleContentAgentSweep();
    expect((await getSettingsRow())?.consecutiveFailures).toBe(1);

    stubYoutubeOembed();
    anthropicMessagesCreateMock.mockResolvedValue({ content: [{ type: "text", text: GOOD_URL }] });
    await runCircleContentAgentSweep();

    const row = await getSettingsRow();
    expect(row?.lastRunOk).toBe(true);
    expect(row?.consecutiveFailures).toBe(0);
  });
});
