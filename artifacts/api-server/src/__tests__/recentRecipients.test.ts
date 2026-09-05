import { describe, it, expect } from "vitest";
import request from "supertest";
import app from "../app";
import { TEST_USER_HEADER } from "./setup";

const SENDER = "clerk_user_recent_recipients";
const OTHER = "clerk_user_recent_recipients_other";

async function sendTo(user: string, recipient: { recipientEmail?: string; recipientPhone?: string }) {
  const res = await request(app)
    .post("/api/whisps")
    .set(TEST_USER_HEADER, user)
    .send({
      videoUrl: "https://youtu.be/x",
      deliveryMethod: "whisper_link",
      whisperChannel: recipient.recipientEmail ? "email" : "sms",
      ...(recipient.recipientEmail ? {} : { smsConsentConfirmed: true }),
      ...recipient,
    });
  expect(res.status).toBe(201);
  return res.body;
}

async function recipientsFor(user: string) {
  const res = await request(app).get("/api/user/recent-recipients").set(TEST_USER_HEADER, user);
  expect(res.status).toBe(200);
  return res.body.items as { value: string; kind: string; useCount: number; lastUsedAt: string }[];
}

describe("GET /api/user/recent-recipients", () => {
  it("returns the addresses this sender has used, with their kind", async () => {
    await sendTo(SENDER, { recipientEmail: "sam@example.com" });
    await sendTo(SENDER, { recipientPhone: "+15551234567" });

    const items = await recipientsFor(SENDER);
    expect(items).toHaveLength(2);
    expect(items.find((i) => i.value === "sam@example.com")?.kind).toBe("email");
    expect(items.find((i) => i.value === "+15551234567")?.kind).toBe("phone");
  });

  // The load-bearing one. This endpoint hands back contact details, so it has
  // to be scoped to what the caller themselves typed — anything wider would
  // leak another sender's contacts, and would also reveal that an address is
  // in use on the platform, which the anti-enumeration rules exist to prevent.
  it("never returns another sender's recipients", async () => {
    await sendTo(SENDER, { recipientEmail: "mine@example.com" });
    await sendTo(OTHER, { recipientEmail: "theirs@example.com" });

    const mine = await recipientsFor(SENDER);
    expect(mine.map((i) => i.value)).toEqual(["mine@example.com"]);

    const theirs = await recipientsFor(OTHER);
    expect(theirs.map((i) => i.value)).toEqual(["theirs@example.com"]);
  });

  it("collapses repeats into one entry and counts them", async () => {
    await sendTo(SENDER, { recipientEmail: "sam@example.com" });
    await sendTo(SENDER, { recipientEmail: "sam@example.com" });
    await sendTo(SENDER, { recipientEmail: "sam@example.com" });

    const items = await recipientsFor(SENDER);
    expect(items).toHaveLength(1);
    expect(items[0].useCount).toBe(3);
  });

  // Split in two rather than four sends in one test: the free plan caps
  // Whisper Links at three, so a fourth send returns 402 and the assertion
  // would fail for a reason that has nothing to do with de-duplication.
  it("treats an email typed in different cases as one contact", async () => {
    await sendTo(SENDER, { recipientEmail: "Sam@Example.com" });
    await sendTo(SENDER, { recipientEmail: "sam@example.com" });

    const items = await recipientsFor(SENDER);
    expect(items).toHaveLength(1);
    expect(items[0].useCount).toBe(2);
  });

  it("treats a phone number formatted differently as one contact", async () => {
    await sendTo(SENDER, { recipientPhone: "+1 555 123 4567" });
    await sendTo(SENDER, { recipientPhone: "+15551234567" });

    const items = await recipientsFor(SENDER);
    expect(items).toHaveLength(1);
    expect(items[0].useCount).toBe(2);
  });

  it("is empty for a sender who hasn't sent to anyone", async () => {
    expect(await recipientsFor(SENDER)).toEqual([]);
  });

  it("orders most recently used first", async () => {
    await sendTo(SENDER, { recipientEmail: "first@example.com" });
    await sendTo(SENDER, { recipientEmail: "second@example.com" });

    const items = await recipientsFor(SENDER);
    expect(items[0].value).toBe("second@example.com");
  });
});
