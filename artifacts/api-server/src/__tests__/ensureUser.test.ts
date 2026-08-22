import { describe, it, expect } from "vitest";
import request from "supertest";
import app from "../app";
import { TEST_USER_HEADER, clerkGetUserMock } from "./setup";
import { randomUUID } from "crypto";

function asUser(userId: string) {
  return { [TEST_USER_HEADER]: userId };
}

// The signup-day Clerk profile fetch can fail (misconfigured key, outage,
// API shape surprise), leaving a `${clerkId}@...` placeholder as the stored
// email. These tests pin the self-heal ensureUser now performs: a later
// sign-in re-fetches from Clerk and repairs the row instead of the
// placeholder being permanent (see ensureUser.ts).
describe("ensureUser placeholder-email self-heal", () => {
  it("stores a placeholder when Clerk has no email, then heals it once Clerk does", async () => {
    const clerkId = `clerk_heal_${randomUUID()}`;

    // Signup with the default mock (no emailAddresses at all — the exact
    // shape that produced TypeErrors in production before the optional
    // chaining) → placeholder email, no crash.
    const first = await request(app).get("/api/user/profile").set(asUser(clerkId));
    expect(first.status).toBe(200);
    expect(first.body.email).toBe(`${clerkId}@blindwhisper.com`);

    // Clerk starts returning the real profile → the next request heals the
    // stored email in place, same account (id unchanged).
    clerkGetUserMock.mockResolvedValue({
      twoFactorEnabled: true,
      emailAddresses: [{ id: "em_1", emailAddress: "healed@example.com" }],
      primaryEmailAddressId: "em_1",
      phoneNumbers: [],
      firstName: "Healed",
      lastName: "Human",
    } as any);
    const second = await request(app).get("/api/user/profile").set(asUser(clerkId));
    expect(second.status).toBe(200);
    expect(second.body.email).toBe("healed@example.com");
    expect(second.body.fullName).toBe("Healed Human");
    expect(second.body.id).toBe(first.body.id);
  });

  it("a healed email that matches ADMIN_EMAILS promotes on the same request", async () => {
    const clerkId = `clerk_heal_admin_${randomUUID()}`;

    const first = await request(app).get("/api/user/profile").set(asUser(clerkId));
    expect(first.body.role).toBe("user");

    process.env.ADMIN_EMAILS = "owner-heal@example.com";
    try {
      clerkGetUserMock.mockResolvedValue({
        twoFactorEnabled: true,
        emailAddresses: [{ id: "em_1", emailAddress: "owner-heal@example.com" }],
        primaryEmailAddressId: "em_1",
        phoneNumbers: [],
        firstName: null,
        lastName: null,
      } as any);
      const second = await request(app).get("/api/user/profile").set(asUser(clerkId));
      expect(second.body.email).toBe("owner-heal@example.com");
      expect(second.body.role).toBe("admin");
    } finally {
      delete process.env.ADMIN_EMAILS;
    }
  });

  it("never overwrites a real stored email", async () => {
    const clerkId = `clerk_heal_real_${randomUUID()}`;
    clerkGetUserMock.mockResolvedValue({
      twoFactorEnabled: true,
      emailAddresses: [{ id: "em_1", emailAddress: "original@example.com" }],
      primaryEmailAddressId: "em_1",
      phoneNumbers: [],
      firstName: null,
      lastName: null,
    } as any);
    const first = await request(app).get("/api/user/profile").set(asUser(clerkId));
    expect(first.body.email).toBe("original@example.com");

    // Even if Clerk later reports a different address, a non-placeholder
    // stored email is left alone — the heal path only ever fires on rows
    // whose email is known-fabricated.
    clerkGetUserMock.mockResolvedValue({
      twoFactorEnabled: true,
      emailAddresses: [{ id: "em_2", emailAddress: "different@example.com" }],
      primaryEmailAddressId: "em_2",
      phoneNumbers: [],
      firstName: null,
      lastName: null,
    } as any);
    const second = await request(app).get("/api/user/profile").set(asUser(clerkId));
    expect(second.body.email).toBe("original@example.com");
  });
});
