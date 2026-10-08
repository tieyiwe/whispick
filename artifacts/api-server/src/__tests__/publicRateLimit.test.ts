import { describe, it, expect } from "vitest";
import request from "supertest";
import app from "../app";

// Public reads and writes have separate per-IP budgets (lib/rateLimit.ts):
// browsing must never be throttled at the tight write ceiling, and the
// 20-second visitor heartbeat must never spend the write budget.
describe("public rate limits", () => {
  it("lets a visitor read well past the 60-request write budget", async () => {
    for (let i = 0; i < 80; i++) {
      const res = await request(app).get("/api/public/debate-topics");
      expect(res.status).toBe(200);
    }
  });

  it("still caps unauthenticated writes at 60 per 5 minutes", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 62; i++) {
      const res = await request(app).post("/api/public/w/no-such-token/reply").send({ replyText: "hi" });
      statuses.push(res.status);
    }
    expect(statuses.slice(0, 60)).not.toContain(429);
    expect(statuses.slice(60)).toEqual([429, 429]);
  });

  it("doesn't count visitor heartbeats against the write budget", async () => {
    for (let i = 0; i < 70; i++) {
      await request(app).post("/api/public/visitor-ping").send({ path: "/", visitorId: "v_rate_test" });
    }
    const res = await request(app).post("/api/public/w/no-such-token/reply").send({ replyText: "hi" });
    expect(res.status).not.toBe(429);
  });
});
