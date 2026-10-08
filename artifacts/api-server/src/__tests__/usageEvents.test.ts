import { describe, it, expect, afterEach } from "vitest";
import request from "supertest";
import app from "../app";
import { TEST_USER_HEADER, anthropicMessagesCreateMock } from "./setup";
import { adminHeaders } from "./adminTestUtils";

const ADMIN_CLERK_ID = "clerk_usage_admin";
const ADMIN_EMAIL = `${ADMIN_CLERK_ID}@blindwhisper.com`;

function asUser(userId: string) {
  return { [TEST_USER_HEADER]: userId };
}

afterEach(() => {
  delete process.env.ADMIN_EMAILS;
});

describe("Feature usage analytics", () => {
  it("records anonymous and signed-in batches and aggregates them for admin", async () => {
    // Anonymous batch.
    const anon = await request(app)
      .post("/api/public/usage-events")
      .send({ events: [{ feature: "button-send-whisp", count: 3 }, { feature: "link-community-guidelines", count: 1 }] });
    expect(anon.status).toBe(204);

    // Signed-in batch — attributed to the account.
    await request(app).get("/api/user/profile").set(asUser("clerk_usage_member"));
    const signedIn = await request(app)
      .post("/api/public/usage-events")
      .set(asUser("clerk_usage_member"))
      .send({ events: [{ feature: "button-send-whisp", count: 2 }] });
    expect(signedIn.status).toBe(204);

    const admin = await adminHeaders(ADMIN_CLERK_ID, ADMIN_EMAIL);
    const stats = await request(app).get("/api/admin/usage-stats?days=7").set(admin);
    expect(stats.status).toBe(200);
    const send = stats.body.items.find((i: any) => i.feature === "button-send-whisp");
    expect(send.totalCount).toBe(5);
    expect(send.distinctUsers).toBe(1);
    const guidelines = stats.body.items.find((i: any) => i.feature === "link-community-guidelines");
    expect(guidelines.totalCount).toBe(1);
    // Most-used-first ordering.
    expect(stats.body.items[0].feature).toBe("button-send-whisp");
  });

  it("rejects junk feature keys and oversized batches", async () => {
    const junk = await request(app)
      .post("/api/public/usage-events")
      .send({ events: [{ feature: "DROP TABLE users; --", count: 1 }] });
    expect(junk.status).toBe(400);

    const oversized = await request(app)
      .post("/api/public/usage-events")
      .send({ events: Array.from({ length: 51 }, (_, i) => ({ feature: `f-${i}`, count: 1 })) });
    expect(oversized.status).toBe(400);
  });

  it("usage stats and insights are admin-only", async () => {
    const stats = await request(app).get("/api/admin/usage-stats").set(asUser("clerk_usage_member"));
    expect(stats.status).toBe(403);
  });

  it("the AI analyzer returns parsed insights from the model's JSON", async () => {
    await request(app)
      .post("/api/public/usage-events")
      .send({ events: [{ feature: "button-rarely-used", count: 1 }, { feature: "button-popular", count: 40 }] });

    anthropicMessagesCreateMock.mockResolvedValueOnce({
      content: [
        {
          type: "text",
          text: '[{"title": "Protect the popular button", "detail": "It dominates usage; keep it prominent."}, {"title": "Trim the rare one", "detail": "Barely used — consider demoting it."}]',
        },
      ],
    });

    const admin = await adminHeaders(ADMIN_CLERK_ID, ADMIN_EMAIL);
    const res = await request(app).post("/api/admin/usage-insights").set(admin).send({ days: 7 });
    expect(res.status).toBe(200);
    expect(res.body.insights).toHaveLength(2);
    expect(res.body.insights[0].title).toContain("popular");
    expect(res.body.statsAnalyzed).toBe(2);
  });

  it("falls back to raw text when the model goes off-format", async () => {
    await request(app).post("/api/public/usage-events").send({ events: [{ feature: "button-x", count: 1 }] });
    anthropicMessagesCreateMock.mockResolvedValueOnce({
      content: [{ type: "text", text: "Just some prose, no JSON here." }],
    });

    const admin = await adminHeaders(ADMIN_CLERK_ID, ADMIN_EMAIL);
    const res = await request(app).post("/api/admin/usage-insights").set(admin).send({ days: 7 });
    expect(res.status).toBe(200);
    expect(res.body.insights).toHaveLength(1);
    expect(res.body.insights[0].detail).toContain("prose");
  });
});
