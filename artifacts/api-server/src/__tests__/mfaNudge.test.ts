import { describe, it, expect } from "vitest";
import request from "supertest";
import app from "../app";
import { TEST_USER_HEADER } from "./setup";

function asUser(userId: string) {
  return { [TEST_USER_HEADER]: userId };
}

describe("POST /api/user/mfa-nudge/dismiss", () => {
  it("requires auth", async () => {
    const res = await request(app).post("/api/user/mfa-nudge/dismiss");
    expect(res.status).toBe(401);
  });

  it("records a dismissal timestamp visible on the profile", async () => {
    const before = await request(app).get("/api/user/profile").set(asUser("clerk_mfa_nudge_user"));
    expect(before.body.mfaNudgeDismissedAt).toBeNull();

    const dismiss = await request(app).post("/api/user/mfa-nudge/dismiss").set(asUser("clerk_mfa_nudge_user"));
    expect(dismiss.status).toBe(204);

    const after = await request(app).get("/api/user/profile").set(asUser("clerk_mfa_nudge_user"));
    expect(after.body.mfaNudgeDismissedAt).toBeTruthy();
  });
});
