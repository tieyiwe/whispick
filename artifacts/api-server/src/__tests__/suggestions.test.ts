import { describe, it, expect, vi, afterEach } from "vitest";
import request from "supertest";
import { randomUUID } from "crypto";
import app from "../app";
import { db, suggestedVideosTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { TEST_USER_HEADER, anthropicMessagesCreateMock } from "./setup";

const ADMIN_CLERK_ID = "clerk_suggestions_admin";
const ADMIN_EMAIL = `${ADMIN_CLERK_ID}@blindwhisper.com`;
const USER_A = "clerk_suggestions_user_a";

function asUser(userId: string) {
  return { [TEST_USER_HEADER]: userId };
}

async function asAdmin() {
  process.env.ADMIN_EMAILS = ADMIN_EMAIL;
  await request(app).get("/api/user/profile").set(asUser(ADMIN_CLERK_ID));
  return asUser(ADMIN_CLERK_ID);
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function stubYoutubeOembed(title = "A great video") {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: any) => {
      const url = String(input);
      if (url.includes("youtube.com/oembed")) {
        return jsonResponse(200, { title, thumbnail_url: "https://img.example/x.jpg", author_name: "Someone" });
      }
      throw new Error(`unexpected fetch: ${url}`);
    }),
  );
}

async function insertSuggestion(overrides: Partial<typeof suggestedVideosTable.$inferInsert> = {}) {
  const id = randomUUID();
  await db.insert(suggestedVideosTable).values({
    id,
    videoUrl: `https://youtu.be/${id.slice(0, 11)}`,
    videoTitle: "Some video",
    categories: ["motivational"],
    featured: false,
    status: "published",
    source: "admin",
    publishedAt: new Date(),
    ...overrides,
  });
  return id;
}

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.ADMIN_EMAILS;
});

describe("Admin: suggestions CRUD", () => {
  it("rejects unauthenticated and non-admin requests", async () => {
    const unauth = await request(app).get("/api/admin/suggestions");
    expect(unauth.status).toBe(401);

    const nonAdmin = await request(app).get("/api/admin/suggestions").set(asUser(USER_A));
    expect(nonAdmin.status).toBe(403);
  });

  it("creates a suggestion from a video URL, scraping metadata and kicking off the AI summary", async () => {
    stubYoutubeOembed("How to let go");
    anthropicMessagesCreateMock.mockResolvedValueOnce({
      content: [{ type: "text", text: "A gentle reminder that it's okay to move on." }],
    });
    const adminHeaders = await asAdmin();

    const res = await request(app)
      .post("/api/admin/suggestions")
      .set(adminHeaders)
      .send({ videoUrl: "https://youtu.be/abc12345678", categories: ["motivational", "spiritual-faith"] });

    expect(res.status).toBe(201);
    expect(res.body.videoTitle).toBe("How to let go");
    expect(res.body.status).toBe("published");
    expect(res.body.source).toBe("admin");
    expect(res.body.categories).toEqual(["motivational", "spiritual-faith"]);
    expect(res.body.publishedAt).not.toBeNull();

    // Fire-and-forget summary generation — give the microtask queue a turn.
    await new Promise((resolve) => setTimeout(resolve, 50));
    const row = await db.select().from(suggestedVideosTable).where(eq(suggestedVideosTable.id, res.body.id)).then((r) => r[0]);
    expect(row?.aiSummaryStatus).toBe("ready");
    expect(row?.aiSummary).toContain("okay to move on");
  });

  it("rejects an invalid category", async () => {
    stubYoutubeOembed();
    const adminHeaders = await asAdmin();
    const res = await request(app)
      .post("/api/admin/suggestions")
      .set(adminHeaders)
      .send({ videoUrl: "https://youtu.be/abc12345678", categories: ["not-a-real-category"] });
    expect(res.status).toBe(400);
  });

  it("rejects a non-allowlisted host without ever fetching it", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const adminHeaders = await asAdmin();

    const res = await request(app)
      .post("/api/admin/suggestions")
      .set(adminHeaders)
      .send({ videoUrl: "http://169.254.169.254/latest/meta-data/", categories: ["motivational"] });

    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("surfaces a 422 for a private/restricted video", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: any) => {
        const url = String(input);
        if (url.includes("youtube.com/oembed")) return jsonResponse(401, {});
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );
    const adminHeaders = await asAdmin();

    const res = await request(app)
      .post("/api/admin/suggestions")
      .set(adminHeaders)
      .send({ videoUrl: "https://youtu.be/abc12345678", categories: ["motivational"] });

    expect(res.status).toBe(422);
    expect(res.body.code).toBe("video_private");
  });

  it("lists suggestions, filterable by status/source/category/featured", async () => {
    const adminHeaders = await asAdmin();
    await insertSuggestion({ status: "pending", source: "ai_agent", categories: ["comedy"] });
    await insertSuggestion({ status: "published", source: "admin", categories: ["motivational"], featured: true });

    const pending = await request(app).get("/api/admin/suggestions?status=pending").set(adminHeaders);
    expect(pending.body.items.every((i: any) => i.status === "pending")).toBe(true);

    const agentSourced = await request(app).get("/api/admin/suggestions?source=ai_agent").set(adminHeaders);
    expect(agentSourced.body.items.every((i: any) => i.source === "ai_agent")).toBe(true);

    const byCategory = await request(app).get("/api/admin/suggestions?category=comedy").set(adminHeaders);
    expect(byCategory.body.items.some((i: any) => i.categories.includes("comedy"))).toBe(true);

    const featured = await request(app).get("/api/admin/suggestions?featured=true").set(adminHeaders);
    expect(featured.body.items.every((i: any) => i.featured === true)).toBe(true);
  });

  it("approves a pending AI-discovered suggestion, setting publishedAt", async () => {
    const adminHeaders = await asAdmin();
    const id = await insertSuggestion({ status: "pending", source: "ai_agent", publishedAt: null });

    const res = await request(app).patch(`/api/admin/suggestions/${id}`).set(adminHeaders).send({ status: "published" });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("published");
    expect(res.body.publishedAt).not.toBeNull();
  });

  it("archives a suggestion", async () => {
    const adminHeaders = await asAdmin();
    const id = await insertSuggestion();

    const res = await request(app).patch(`/api/admin/suggestions/${id}`).set(adminHeaders).send({ status: "archived" });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("archived");
  });

  it("a manual aiSummary override marks the status ready so the background generator won't overwrite it", async () => {
    const adminHeaders = await asAdmin();
    const id = await insertSuggestion({ aiSummaryStatus: null, aiSummary: null });

    const res = await request(app).patch(`/api/admin/suggestions/${id}`).set(adminHeaders).send({ aiSummary: "Hand-written blurb." });
    expect(res.status).toBe(200);
    expect(res.body.aiSummary).toBe("Hand-written blurb.");
    expect(res.body.aiSummaryStatus).toBe("ready");
  });

  it("deletes a suggestion", async () => {
    const adminHeaders = await asAdmin();
    const id = await insertSuggestion();

    const res = await request(app).delete(`/api/admin/suggestions/${id}`).set(adminHeaders);
    expect(res.status).toBe(204);

    const row = await db.select().from(suggestedVideosTable).where(eq(suggestedVideosTable.id, id)).then((r) => r[0]);
    expect(row).toBeUndefined();
  });

  it("404s for a suggestion that doesn't exist", async () => {
    const adminHeaders = await asAdmin();
    const res = await request(app).get(`/api/admin/suggestions/${randomUUID()}`).set(adminHeaders);
    expect(res.status).toBe(404);
  });
});

describe("Admin: suggestion discovery agent status + manual trigger", () => {
  it("rejects unauthenticated and non-admin requests for both endpoints", async () => {
    expect((await request(app).get("/api/admin/suggestions/agent-status")).status).toBe(401);
    expect((await request(app).post("/api/admin/suggestions/run-agent")).status).toBe(401);

    const status = await request(app).get("/api/admin/suggestions/agent-status").set(asUser(USER_A));
    expect(status.status).toBe(403);

    const run = await request(app).post("/api/admin/suggestions/run-agent").set(asUser(USER_A));
    expect(run.status).toBe(403);
  });

  it("reports a healthy 'never run' default before the agent has ever run", async () => {
    const adminHeaders = await asAdmin();
    const res = await request(app).get("/api/admin/suggestions/agent-status").set(adminHeaders);
    expect(res.status).toBe(200);
    expect(res.body.lastRunAt).toBeNull();
    expect(res.body.lastRunOk).toBe(true);
    expect(res.body.lowCreditSuspected).toBe(false);
  });

  it("POST /run-agent triggers a sweep immediately and reflects a low-credit failure in the returned status", async () => {
    anthropicMessagesCreateMock.mockRejectedValue(
      new Error("Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to purchase credits."),
    );
    const adminHeaders = await asAdmin();

    const res = await request(app).post("/api/admin/suggestions/run-agent").set(adminHeaders);
    expect(res.status).toBe(200);
    expect(res.body.inserted).toBe(0);
    expect(res.body.status.lastRunOk).toBe(false);
    expect(res.body.status.lowCreditSuspected).toBe(true);

    const followUp = await request(app).get("/api/admin/suggestions/agent-status").set(adminHeaders);
    expect(followUp.body.lowCreditSuspected).toBe(true);
  });
});

describe("User-facing: GET /api/suggestions", () => {
  it("requires auth", async () => {
    const res = await request(app).get("/api/suggestions");
    expect(res.status).toBe(401);
  });

  it("only ever returns published suggestions, never pending or archived", async () => {
    await insertSuggestion({ status: "published", categories: ["comedy"] });
    await insertSuggestion({ status: "pending", source: "ai_agent", categories: ["comedy"] });
    await insertSuggestion({ status: "archived", categories: ["comedy"] });

    const res = await request(app).get("/api/suggestions").set(asUser(USER_A));
    expect(res.status).toBe(200);
    expect(res.body.items.length).toBe(1);
    expect(res.body.items[0].status).toBe("published");
  });

  it("filters by category and featured", async () => {
    await insertSuggestion({ status: "published", categories: ["comedy"], featured: false });
    await insertSuggestion({ status: "published", categories: ["motivational"], featured: true });

    const byCategory = await request(app).get("/api/suggestions?category=comedy").set(asUser(USER_A));
    expect(byCategory.body.items.every((i: any) => i.categories.includes("comedy"))).toBe(true);

    const featuredOnly = await request(app).get("/api/suggestions?featured=true").set(asUser(USER_A));
    expect(featuredOnly.body.items.every((i: any) => i.featured === true)).toBe(true);
  });

  it("includes the category taxonomy for the filter UI", async () => {
    const res = await request(app).get("/api/suggestions").set(asUser(USER_A));
    expect(res.body.categories.some((c: any) => c.key === "motivational")).toBe(true);
  });

  it("GET /api/suggestions/:id 404s for a pending suggestion (not yet approved)", async () => {
    const id = await insertSuggestion({ status: "pending", source: "ai_agent" });
    const res = await request(app).get(`/api/suggestions/${id}`).set(asUser(USER_A));
    expect(res.status).toBe(404);
  });

  it("GET /api/suggestions/:id returns a published suggestion", async () => {
    const id = await insertSuggestion({ status: "published" });
    const res = await request(app).get(`/api/suggestions/${id}`).set(asUser(USER_A));
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(id);
  });
});
