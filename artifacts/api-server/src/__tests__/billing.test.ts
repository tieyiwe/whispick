import { describe, it, expect } from "vitest";
import request from "supertest";
import app from "../app";
import { TEST_USER_HEADER } from "./setup";

describe("POST /api/billing/checkout", () => {
  it("rejects unauthenticated requests", async () => {
    const res = await request(app).post("/api/billing/checkout").send({ kind: "credit_pack", id: "single" });
    expect(res.status).toBe(401);
  });

  it("returns 503 when Stripe isn't configured", async () => {
    const res = await request(app)
      .post("/api/billing/checkout")
      .set(TEST_USER_HEADER, "clerk_billing_user")
      .send({ kind: "credit_pack", id: "single" });

    expect(res.status).toBe(503);
  });
});
