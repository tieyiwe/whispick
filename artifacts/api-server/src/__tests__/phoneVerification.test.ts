import { describe, it, expect, vi, afterEach } from "vitest";
import request from "supertest";
import { db, usersTable, textWhispsTable } from "@workspace/db";
import { randomUUID } from "crypto";
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

  // Regression for a real production report: a recipient who verifies their
  // number AFTER a Text Whisp was already sent to it (the ordinary "I got a
  // text, so I signed up" flow — routes/textWhisps.ts POST / only matches
  // findVerifiedRecipient synchronously at send time, never again later)
  // used to stay permanently unlinked from that Text Whisp: it never showed
  // up in their own authenticated list/detail view, so there was no closed
  // scroll to tap and no reveal — because the recipient-side query
  // (recipientUserId = viewer) never matched the row at all.
  it("backfills recipientUserId on any Text Whisp already sent to this number once it's verified", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(200, { status: "approved" })));

    const senderId = randomUUID();
    await db.insert(usersTable).values({
      id: senderId,
      clerkId: "clerk_backfill_sender",
      email: "clerk_backfill_sender@example.com",
      plan: "free",
      boostCredits: 0,
      whisperLinksUsed: 0,
    });

    const textWhispId = randomUUID();
    await db.insert(textWhispsTable).values({
      id: textWhispId,
      senderId,
      recipientUserId: null,
      recipientPhone: "+15558889999",
      publicToken: randomUUID().replace(/-/g, ""),
      messageText: "sent before you verified",
      status: "sent",
    });

    const res = await request(app)
      .post("/api/user/phone/confirm-verification")
      .set(asUser("clerk_backfill_recipient"))
      .send({ phone: "+15558889999", code: "123456" });
    expect(res.status).toBe(200);

    const recipientRow = await db.select().from(usersTable).where(eq(usersTable.clerkId, "clerk_backfill_recipient")).then((r) => r[0]);
    const textWhispRow = await db.select().from(textWhispsTable).where(eq(textWhispsTable.id, textWhispId)).then((r) => r[0]);
    expect(textWhispRow?.recipientUserId).toBe(recipientRow?.id);
  });

  it("never backfills a Text Whisp the verifying user sent themselves (no self-recipient)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(200, { status: "approved" })));

    const senderClerkId = "clerk_backfill_self_sender";
    await request(app).get("/api/user/profile").set(asUser(senderClerkId)); // ensureUser
    const senderRow = await db.select().from(usersTable).where(eq(usersTable.clerkId, senderClerkId)).then((r) => r[0]!);

    const textWhispId = randomUUID();
    await db.insert(textWhispsTable).values({
      id: textWhispId,
      senderId: senderRow.id,
      recipientUserId: null,
      recipientPhone: "+15558887777",
      publicToken: randomUUID().replace(/-/g, ""),
      messageText: "sent to my own not-yet-verified number",
      status: "sent",
    });

    await request(app)
      .post("/api/user/phone/confirm-verification")
      .set(asUser(senderClerkId))
      .send({ phone: "+15558887777", code: "123456" });

    const textWhispRow = await db.select().from(textWhispsTable).where(eq(textWhispsTable.id, textWhispId)).then((r) => r[0]);
    expect(textWhispRow?.recipientUserId).toBeNull();
  });

  it("never reassigns a Text Whisp that's already matched to a different (prior) recipient", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(200, { status: "approved" })));

    const senderId = randomUUID();
    const priorRecipientId = randomUUID();
    await db.insert(usersTable).values([
      { id: senderId, clerkId: "clerk_backfill_sender2", email: "s2@example.com", plan: "free", boostCredits: 0, whisperLinksUsed: 0 },
      { id: priorRecipientId, clerkId: "clerk_backfill_prior_recipient", email: "prior@example.com", plan: "free", boostCredits: 0, whisperLinksUsed: 0 },
    ]);

    const textWhispId = randomUUID();
    await db.insert(textWhispsTable).values({
      id: textWhispId,
      senderId,
      recipientUserId: priorRecipientId,
      recipientPhone: "+15558886666",
      publicToken: randomUUID().replace(/-/g, ""),
      messageText: "already matched to someone",
      status: "sent",
    });

    // A different person later verifies the same (recycled) number.
    await request(app)
      .post("/api/user/phone/confirm-verification")
      .set(asUser("clerk_backfill_new_holder"))
      .send({ phone: "+15558886666", code: "123456" });

    const textWhispRow = await db.select().from(textWhispsTable).where(eq(textWhispsTable.id, textWhispId)).then((r) => r[0]);
    expect(textWhispRow?.recipientUserId).toBe(priorRecipientId);
  });
});
