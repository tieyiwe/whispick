import { describe, it, expect, vi, afterEach } from "vitest";
import request from "supertest";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { TEST_USER_HEADER } from "./setup";

// Set BEFORE importing app (which transitively imports lib/phoneVerification.ts,
// whose TWILIO_* consts are captured at module-load time — same pattern as
// lib/sms.ts) so this file's requests exercise the "configured" branch
// instead of the warn-and-no-op one. Not shared with other test files: each
// vitest test file gets its own module registry.
process.env.TWILIO_ACCOUNT_SID = "test-account-sid";
process.env.TWILIO_AUTH_TOKEN = "test-auth-token";
process.env.TWILIO_VERIFY_SERVICE_SID = "test-verify-service-sid";

const { default: app } = await import("../app");

function asUser(userId: string) {
  return { [TEST_USER_HEADER]: userId };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("POST /api/user/phone/start-verification", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("starts a Twilio Verify challenge against the normalized phone number", async () => {
    const fetchMock = vi.fn(async (input: any, init: any) => {
      expect(String(input)).toContain("/Verifications");
      const body = new URLSearchParams(String(init.body));
      expect(body.get("To")).toBe("+15551234567");
      expect(body.get("Channel")).toBe("sms");
      return jsonResponse(201, { status: "pending" });
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = await request(app)
      .post("/api/user/phone/start-verification")
      .set(asUser("clerk_start_ok"))
      .send({ phone: "+1 (555) 123-4567" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects an unparseable phone number without ever calling Twilio", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const res = await request(app)
      .post("/api/user/phone/start-verification")
      .set(asUser("clerk_start_bad"))
      .send({ phone: "not a phone number" });

    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("surfaces a clean error when Twilio Verify rejects the request", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("boom", { status: 500 })));

    const res = await request(app)
      .post("/api/user/phone/start-verification")
      .set(asUser("clerk_start_fail"))
      .send({ phone: "+15551234567" });

    expect(res.status).toBe(502);
    expect(res.body.error).toBeTruthy();
  });
});

describe("POST /api/user/phone/confirm-verification", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("verifies the code, normalizes and stores the phone, and sets phoneVerifiedAt", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(200, { status: "approved" })));

    const res = await request(app)
      .post("/api/user/phone/confirm-verification")
      .set(asUser("clerk_confirm_ok"))
      .send({ phone: "+1 (555) 123-4567", code: "123456" });

    expect(res.status).toBe(200);
    expect(res.body.phone).toBe("+15551234567");
    expect(res.body.phoneVerifiedAt).toBeTruthy();

    const row = await db.select().from(usersTable).where(eq(usersTable.clerkId, "clerk_confirm_ok")).then((r) => r[0]);
    expect(row?.phone).toBe("+15551234567");
    expect(row?.phoneVerifiedAt).not.toBeNull();
  });

  it("rejects a wrong or expired code with a clear error, and does not verify the user", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(200, { status: "pending" })));

    const res = await request(app)
      .post("/api/user/phone/confirm-verification")
      .set(asUser("clerk_confirm_wrong"))
      .send({ phone: "+15551234567", code: "000000" });

    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();

    const row = await db.select().from(usersTable).where(eq(usersTable.clerkId, "clerk_confirm_wrong")).then((r) => r[0]);
    expect(row?.phoneVerifiedAt).toBeNull();
  });

  it("rejects an unparseable phone number before ever calling Twilio", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const res = await request(app)
      .post("/api/user/phone/confirm-verification")
      .set(asUser("clerk_confirm_bad"))
      .send({ phone: "nope", code: "123456" });

    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("clears a recycled number from any other account when a new holder verifies it", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(200, { status: "approved" })));

    // First person verifies the number.
    await request(app)
      .post("/api/user/phone/confirm-verification")
      .set(asUser("clerk_recycle_old"))
      .send({ phone: "+15557654321", code: "123456" });

    // Later, the number is recycled and a different person verifies it.
    const res = await request(app)
      .post("/api/user/phone/confirm-verification")
      .set(asUser("clerk_recycle_new"))
      .send({ phone: "+15557654321", code: "123456" });
    expect(res.status).toBe(200);

    // The old account no longer claims the number as verified, so in-app
    // routing can't mis-deliver to it.
    const oldRow = await db.select().from(usersTable).where(eq(usersTable.clerkId, "clerk_recycle_old")).then((r) => r[0]);
    expect(oldRow?.phone).toBeNull();
    expect(oldRow?.phoneVerifiedAt).toBeNull();

    const newRow = await db.select().from(usersTable).where(eq(usersTable.clerkId, "clerk_recycle_new")).then((r) => r[0]);
    expect(newRow?.phone).toBe("+15557654321");
    expect(newRow?.phoneVerifiedAt).not.toBeNull();
  });
});
