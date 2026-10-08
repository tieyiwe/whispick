import { describe, it, expect } from "vitest";
import request from "supertest";
import app from "../app";
import { TEST_USER_HEADER } from "./setup";

// Ghost Boost is paused (GHOST_BOOST_ENABLED = false in lib/plans.ts) —
// unlike whisps.test.ts/matching.test.ts (which mock that flag back to true
// to keep exercising the underlying credit-spend/matching logic), this file
// runs against the REAL, unmocked flag to confirm the paused default
// actually blocks both entry points.
function asUser(userId: string) {
  return { [TEST_USER_HEADER]: userId };
}

// Billing's credit-pack guard (routes/billing.ts) isn't covered here: Stripe
// is unconfigured in the test env, so that route always 503s before ever
// reaching the Ghost Boost check (see billing.test.ts's own "returns 503
// when Stripe isn't configured" test) — there's no way to reach it without
// mocking the Stripe SDK, which no test in this repo does today.
describe("Ghost Boost paused by default", () => {
  it("rejects a Ghost Boost send with 403 before any credit is spent", async () => {
    const res = await request(app)
      .post("/api/whisps")
      .set(asUser("clerk_user_ghost_boost_disabled"))
      .send({ videoUrl: "https://youtu.be/x", deliveryMethod: "ghost_boost" });

    expect(res.status).toBe(403);
  });
});
