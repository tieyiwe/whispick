import { describe, it, expect } from "vitest";
import request from "supertest";
import app from "../app";
import { TEST_USER_HEADER } from "./setup";

const USER_A = "clerk_user_a";

function asUser(userId: string) {
  return { [TEST_USER_HEADER]: userId };
}

describe("GET /api/user/push-public-key", () => {
  it("returns 503 when VAPID keys aren't configured", async () => {
    const res = await request(app).get("/api/user/push-public-key").set(asUser(USER_A));
    expect(res.status).toBe(503);
  });
});

describe("POST/DELETE /api/user/push-subscription", () => {
  it("rejects unauthenticated requests", async () => {
    const res = await request(app)
      .post("/api/user/push-subscription")
      .send({ endpoint: "https://push.example.com/abc", keys: { p256dh: "p", auth: "a" } });
    expect(res.status).toBe(401);
  });

  it("registers and then removes a subscription", async () => {
    const created = await request(app)
      .post("/api/user/push-subscription")
      .set(asUser(USER_A))
      .send({ endpoint: "https://push.example.com/abc", keys: { p256dh: "p", auth: "a" } });
    expect(created.status).toBe(201);

    const deleted = await request(app)
      .delete("/api/user/push-subscription")
      .set(asUser(USER_A))
      .send({ endpoint: "https://push.example.com/abc" });
    expect(deleted.status).toBe(204);
  });

  it("upserts on the same endpoint instead of erroring", async () => {
    const first = await request(app)
      .post("/api/user/push-subscription")
      .set(asUser(USER_A))
      .send({ endpoint: "https://push.example.com/dupe", keys: { p256dh: "p1", auth: "a1" } });
    expect(first.status).toBe(201);

    const second = await request(app)
      .post("/api/user/push-subscription")
      .set(asUser(USER_A))
      .send({ endpoint: "https://push.example.com/dupe", keys: { p256dh: "p2", auth: "a2" } });
    expect(second.status).toBe(201);
  });
});
