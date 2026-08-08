import { describe, it, expect } from "vitest";
import { randomUUID } from "crypto";
import { db, usersTable, deliveryAttemptsTable, notificationsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { deliverWhisperLink } from "../lib/deliver";
import { normalizePhoneE164 } from "../lib/phone";

// Twilio isn't configured in the test environment (no TWILIO_* env vars —
// see setup.ts), so an unmatched sms/whatsapp send here always falls
// through sendSms/sendWhatsApp's own "not configured" no-op path rather
// than making a real network call — same pattern every other Twilio/Resend
// test in this codebase relies on. What's under test is purely the
// *routing decision* deliverWhisperLink makes before it ever gets to
// sendSms/sendWhatsApp: did it find a verified match and skip Twilio
// entirely, or fall through to the (here, no-op) Twilio path.

async function insertUser(overrides: Partial<typeof usersTable.$inferInsert> = {}) {
  const id = randomUUID();
  await db.insert(usersTable).values({
    id,
    clerkId: `clerk_${id}`,
    email: `${id}@example.com`,
    plan: "free",
    boostCredits: 0,
    whisperLinksUsed: 0,
    ...overrides,
  });
  return id;
}

function fakeWhisp(overrides: Partial<{ whisperChannel: string | null; recipientPhone: string | null }> = {}) {
  return {
    id: randomUUID(),
    publicToken: randomUUID().replace(/-/g, ""),
    whisperChannel: "sms",
    recipientEmail: null,
    recipientPhone: "+15559876543",
    ...overrides,
  };
}

describe("normalizePhoneE164", () => {
  it("normalizes a variety of US formats to the same E.164 value", () => {
    expect(normalizePhoneE164("+1 555 987 6543")).toBe("+15559876543");
    expect(normalizePhoneE164("(555) 987-6543")).toBe("+15559876543");
    expect(normalizePhoneE164("555.987.6543")).toBe("+15559876543");
    expect(normalizePhoneE164("15559876543")).toBe("+15559876543");
  });

  it("returns null for something that isn't a plausible phone number", () => {
    expect(normalizePhoneE164("not a phone number")).toBeNull();
    expect(normalizePhoneE164("123")).toBeNull();
    expect(normalizePhoneE164("")).toBeNull();
  });
});

describe("deliverWhisperLink — verified-recipient matching (skip Twilio)", () => {
  it("routes to the in-app notification system when the recipient phone matches a verified user, for SMS", async () => {
    const matchedUserId = await insertUser({ phone: "+15559876543", phoneVerifiedAt: new Date() });
    const whisp = fakeWhisp({ whisperChannel: "sms", recipientPhone: "+1 (555) 987-6543" });

    const success = await deliverWhisperLink(whisp, "https://example.com");
    expect(success).toBe(true);

    const attempts = await db.select().from(deliveryAttemptsTable).where(eq(deliveryAttemptsTable.whispId, whisp.id));
    expect(attempts).toHaveLength(1);
    expect(attempts[0].channel).toBe("in_app");
    expect(attempts[0].success).toBe(true);

    const notifications = await db.select().from(notificationsTable).where(eq(notificationsTable.targetUserId, matchedUserId));
    expect(notifications).toHaveLength(1);
    expect(notifications[0].url).toBe(`/w/${whisp.publicToken}`);
  });

  it("routes to the in-app notification system when matched, for WhatsApp too", async () => {
    const matchedUserId = await insertUser({ phone: "+15559876543", phoneVerifiedAt: new Date() });
    const whisp = fakeWhisp({ whisperChannel: "whatsapp", recipientPhone: "+15559876543" });

    await deliverWhisperLink(whisp, "https://example.com");

    const attempts = await db.select().from(deliveryAttemptsTable).where(eq(deliveryAttemptsTable.whispId, whisp.id));
    expect(attempts[0].channel).toBe("in_app");

    const notifications = await db.select().from(notificationsTable).where(eq(notificationsTable.targetUserId, matchedUserId));
    expect(notifications).toHaveLength(1);
  });

  it("falls through to the existing Twilio path when the phone matches no user at all", async () => {
    const whisp = fakeWhisp({ whisperChannel: "sms", recipientPhone: "+15559876543" });

    await deliverWhisperLink(whisp, "https://example.com");

    const attempts = await db.select().from(deliveryAttemptsTable).where(eq(deliveryAttemptsTable.whispId, whisp.id));
    expect(attempts).toHaveLength(1);
    expect(attempts[0].channel).toBe("sms");

    const notifications = await db.select().from(notificationsTable);
    expect(notifications).toHaveLength(0);
  });

  it("falls through to Twilio when the phone matches a user whose number was only Clerk-synced, never OTP-verified", async () => {
    await insertUser({ phone: "+15559876543", phoneVerifiedAt: null });
    const whisp = fakeWhisp({ whisperChannel: "sms", recipientPhone: "+15559876543" });

    await deliverWhisperLink(whisp, "https://example.com");

    const attempts = await db.select().from(deliveryAttemptsTable).where(eq(deliveryAttemptsTable.whispId, whisp.id));
    expect(attempts[0].channel).toBe("sms");

    const notifications = await db.select().from(notificationsTable);
    expect(notifications).toHaveLength(0);
  });

  it("matches regardless of how the sender formatted the recipient's number, as long as it normalizes the same", async () => {
    await insertUser({ phone: "+15559876543", phoneVerifiedAt: new Date() });
    const whisp = fakeWhisp({ whisperChannel: "sms", recipientPhone: "(555) 987-6543" });

    await deliverWhisperLink(whisp, "https://example.com");

    const attempts = await db.select().from(deliveryAttemptsTable).where(eq(deliveryAttemptsTable.whispId, whisp.id));
    expect(attempts[0].channel).toBe("in_app");
  });

  it("never matches on email delivery, only sms/whatsapp", async () => {
    await insertUser({ phone: "+15559876543", phoneVerifiedAt: new Date() });
    const whisp = fakeWhisp({ whisperChannel: "email", recipientPhone: null });
    (whisp as any).recipientEmail = "someone@example.com";

    await deliverWhisperLink(whisp, "https://example.com");

    const notifications = await db.select().from(notificationsTable);
    expect(notifications).toHaveLength(0);
  });
});

describe("anti-enumeration: matched vs unmatched responses are indistinguishable", () => {
  it("POST /whisps returns the identical response shape whether or not the recipient phone matches a verified user", async () => {
    const { default: app } = await import("../app");
    const request = (await import("supertest")).default;
    const { TEST_USER_HEADER } = await import("./setup");

    await insertUser({ phone: "+15559876543", phoneVerifiedAt: new Date() });

    const matchedRes = await request(app)
      .post("/api/whisps")
      .set(TEST_USER_HEADER, "clerk_enum_matched")
      .send({
        videoUrl: "https://youtu.be/x",
        deliveryMethod: "whisper_link",
        whisperChannel: "sms",
        recipientPhone: "+15559876543",
      });

    const unmatchedRes = await request(app)
      .post("/api/whisps")
      .set(TEST_USER_HEADER, "clerk_enum_unmatched")
      .send({
        videoUrl: "https://youtu.be/x",
        deliveryMethod: "whisper_link",
        whisperChannel: "sms",
        recipientPhone: "+15550001111",
      });

    // Same status, and the same set of body keys — nothing about the
    // response reveals which internal delivery path (in-app vs Twilio) will
    // run. The actual routing decision happens in a fire-and-forget call
    // made AFTER this response is already sent (see deliver.ts's
    // ANTI-ENUMERATION comment) — this asserts that contract holds at the
    // HTTP layer, not just by code inspection.
    expect(matchedRes.status).toBe(unmatchedRes.status);
    expect(Object.keys(matchedRes.body).sort()).toEqual(Object.keys(unmatchedRes.body).sort());
    expect(matchedRes.body.status).toBe(unmatchedRes.body.status);
    expect(matchedRes.body.whisperChannel).toBe(unmatchedRes.body.whisperChannel);
  });
});
