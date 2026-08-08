import { describe, it, expect } from "vitest";
import { randomUUID } from "crypto";
import request from "supertest";
import app from "../app";
import { db, usersTable, textWhispsTable, textWhispRepliesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { TEST_USER_HEADER } from "./setup";
import { textWhispGuestSmsBody } from "../lib/sms";

const USER_A = "clerk_text_whisp_a"; // sender
const USER_B = "clerk_text_whisp_b"; // recipient — verified
const USER_C = "clerk_text_whisp_c"; // unrelated third party

function asUser(userId: string) {
  return { [TEST_USER_HEADER]: userId };
}

async function insertUser(clerkId: string, overrides: Partial<typeof usersTable.$inferInsert> = {}) {
  const id = randomUUID();
  await db.insert(usersTable).values({
    id,
    clerkId,
    email: `${id}@example.com`,
    plan: "free",
    boostCredits: 0,
    whisperLinksUsed: 0,
    ...overrides,
  });
  return id;
}

async function getUser(clerkId: string) {
  return db.select().from(usersTable).where(eq(usersTable.clerkId, clerkId)).then((r) => r[0]);
}

const RECIPIENT_PHONE = "+15559876543";

async function setupSenderAndVerifiedRecipient() {
  const senderId = await insertUser(USER_A);
  const recipientId = await insertUser(USER_B, { phone: RECIPIENT_PHONE, phoneVerifiedAt: new Date() });
  return { senderId, recipientId };
}

describe("POST /api/text-whisps", () => {
  it("rejects unauthenticated requests", async () => {
    const res = await request(app).post("/api/text-whisps").send({ recipientPhone: RECIPIENT_PHONE, messageText: "hi" });
    expect(res.status).toBe(401);
  });

  it("rejects a message over 260 characters", async () => {
    await setupSenderAndVerifiedRecipient();
    const res = await request(app)
      .post("/api/text-whisps")
      .set(asUser(USER_A))
      .send({ recipientPhone: RECIPIENT_PHONE, messageText: "x".repeat(261) });

    expect(res.status).toBe(400);
  });

  it("accepts a message at exactly the 260 character limit", async () => {
    await setupSenderAndVerifiedRecipient();
    const res = await request(app)
      .post("/api/text-whisps")
      .set(asUser(USER_A))
      .send({ recipientPhone: RECIPIENT_PHONE, messageText: "x".repeat(260) });

    expect(res.status).toBe(201);
  });

  it("rejects an unparseable phone number", async () => {
    await insertUser(USER_A);
    const res = await request(app)
      .post("/api/text-whisps")
      .set(asUser(USER_A))
      .send({ recipientPhone: "not a phone number", messageText: "hello" });

    expect(res.status).toBe(400);
  });

  it("rejects sending a Text Whisp to yourself", async () => {
    await insertUser(USER_A, { phone: "+15552223333", phoneVerifiedAt: new Date() });
    const res = await request(app)
      .post("/api/text-whisps")
      .set(asUser(USER_A))
      .send({ recipientPhone: "+15552223333", messageText: "hello me" });

    expect(res.status).toBe(400);
  });

  it("creates the Text Whisp and delivers it entirely in-app when the recipient is a known, verified user (regression)", async () => {
    const { recipientId } = await setupSenderAndVerifiedRecipient();

    const res = await request(app)
      .post("/api/text-whisps")
      .set(asUser(USER_A))
      .send({ recipientPhone: RECIPIENT_PHONE, messageText: "You matter.", senderAlias: "A friend" });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe("sent");
    expect(res.body.recipientUserId).toBe(recipientId);
    expect(res.body.recipientPhone).toBe(RECIPIENT_PHONE);
    expect(res.body.publicToken).toBeTruthy();
    expect(res.body.messageText).toBe("You matter.");

    const row = await db.select().from(textWhispsTable).where(eq(textWhispsTable.id, res.body.id)).then((r) => r[0]);
    expect(row).toBeTruthy();
    expect(row.recipientUserId).toBe(recipientId);
  });

  it("creates the Text Whisp with recipientUserId null when the phone number isn't a known, verified user, and stores the normalized phone + a public token", async () => {
    await insertUser(USER_A);
    // No recipient user inserted at all — an arbitrary phone number.
    const res = await request(app)
      .post("/api/text-whisps")
      .set(asUser(USER_A))
      .send({ recipientPhone: "+15550000000", messageText: "Hey there." });

    expect(res.status).toBe(201);
    expect(res.body.recipientUserId).toBeNull();
    expect(res.body.recipientPhone).toBe("+15550000000");
    expect(res.body.publicToken).toBeTruthy();
    expect(typeof res.body.publicToken).toBe("string");

    const row = await db.select().from(textWhispsTable).where(eq(textWhispsTable.id, res.body.id)).then((r) => r[0]);
    expect(row).toBeTruthy();
    expect(row.recipientUserId).toBeNull();
    expect(row.recipientPhone).toBe("+15550000000");
    expect(row.publicToken).toBe(res.body.publicToken);
  });

  it("does not match an unverified phone (phone set but phoneVerifiedAt null) — treated as a guest send", async () => {
    await insertUser(USER_A);
    await insertUser(USER_B, { phone: RECIPIENT_PHONE, phoneVerifiedAt: null });

    const res = await request(app)
      .post("/api/text-whisps")
      .set(asUser(USER_A))
      .send({ recipientPhone: RECIPIENT_PHONE, messageText: "hello" });

    expect(res.status).toBe(201);
    expect(res.body.recipientUserId).toBeNull();
  });
});

describe("GET /api/text-whisps/:id", () => {
  async function createTextWhisp() {
    await setupSenderAndVerifiedRecipient();
    const res = await request(app)
      .post("/api/text-whisps")
      .set(asUser(USER_A))
      .send({ recipientPhone: RECIPIENT_PHONE, messageText: "hi there" });
    return res.body.id as string;
  }

  it("is visible to the sender", async () => {
    const id = await createTextWhisp();
    const res = await request(app).get(`/api/text-whisps/${id}`).set(asUser(USER_A));
    expect(res.status).toBe(200);
    expect(res.body.textWhisp.id).toBe(id);
  });

  it("is visible to the recipient and marks it read", async () => {
    const id = await createTextWhisp();
    const res = await request(app).get(`/api/text-whisps/${id}`).set(asUser(USER_B));
    expect(res.status).toBe(200);
    expect(res.body.textWhisp.status).toBe("read");
    expect(res.body.textWhisp.readAt).not.toBeNull();
  });

  it("is invisible to an unrelated third party", async () => {
    const id = await createTextWhisp();
    await insertUser(USER_C);
    const res = await request(app).get(`/api/text-whisps/${id}`).set(asUser(USER_C));
    expect(res.status).toBe(404);
  });

  it("does not mark it read when the sender views their own sent message", async () => {
    const id = await createTextWhisp();
    await request(app).get(`/api/text-whisps/${id}`).set(asUser(USER_A));
    const row = await db.select().from(textWhispsTable).where(eq(textWhispsTable.id, id)).then((r) => r[0]);
    expect(row.status).toBe("sent");
    expect(row.readAt).toBeNull();
  });
});

describe("DELETE /api/text-whisps/:id — soft delete", () => {
  async function createTextWhisp() {
    await setupSenderAndVerifiedRecipient();
    const res = await request(app)
      .post("/api/text-whisps")
      .set(asUser(USER_A))
      .send({ recipientPhone: RECIPIENT_PHONE, messageText: "hi there" });
    return res.body.id as string;
  }

  it("hides it from the sender's own list without deleting the row", async () => {
    const id = await createTextWhisp();

    const del = await request(app).delete(`/api/text-whisps/${id}`).set(asUser(USER_A));
    expect(del.status).toBe(204);

    const senderGet = await request(app).get(`/api/text-whisps/${id}`).set(asUser(USER_A));
    expect(senderGet.status).toBe(404);

    const senderList = await request(app).get("/api/text-whisps").set(asUser(USER_A));
    expect(senderList.body.find((t: any) => t.id === id)).toBeUndefined();

    const row = await db.select().from(textWhispsTable).where(eq(textWhispsTable.id, id)).then((r) => r[0]);
    expect(row).toBeTruthy();
    expect(row.deletedBySenderAt).not.toBeNull();
  });

  it("does not affect the recipient's own view", async () => {
    const id = await createTextWhisp();
    await request(app).delete(`/api/text-whisps/${id}`).set(asUser(USER_A));

    const recipientGet = await request(app).get(`/api/text-whisps/${id}`).set(asUser(USER_B));
    expect(recipientGet.status).toBe(200);

    const recipientList = await request(app).get("/api/text-whisps").set(asUser(USER_B));
    expect(recipientList.body.find((t: any) => t.id === id)).toBeTruthy();
  });

  it("cannot be deleted by the recipient", async () => {
    const id = await createTextWhisp();
    const res = await request(app).delete(`/api/text-whisps/${id}`).set(asUser(USER_B));
    expect(res.status).toBe(404);
  });
});

describe("Text Whisp replies", () => {
  async function createTextWhisp() {
    await setupSenderAndVerifiedRecipient();
    const res = await request(app)
      .post("/api/text-whisps")
      .set(asUser(USER_A))
      .send({ recipientPhone: RECIPIENT_PHONE, messageText: "hi there" });
    return res.body.id as string;
  }

  it("rejects a reply over 260 characters", async () => {
    const id = await createTextWhisp();
    const res = await request(app)
      .post(`/api/text-whisps/${id}/replies`)
      .set(asUser(USER_B))
      .send({ replyText: "x".repeat(261) });
    expect(res.status).toBe(400);
  });

  it("accepts a reply at exactly the 260 character limit, from either party", async () => {
    const id = await createTextWhisp();
    const fromRecipient = await request(app)
      .post(`/api/text-whisps/${id}/replies`)
      .set(asUser(USER_B))
      .send({ replyText: "x".repeat(260) });
    expect(fromRecipient.status).toBe(201);

    const fromSender = await request(app)
      .post(`/api/text-whisps/${id}/replies`)
      .set(asUser(USER_A))
      .send({ replyText: "y".repeat(260) });
    expect(fromSender.status).toBe(201);
  });

  it("sets status to replied when the recipient replies", async () => {
    const id = await createTextWhisp();
    await request(app).post(`/api/text-whisps/${id}/replies`).set(asUser(USER_B)).send({ replyText: "thanks" });

    const row = await db.select().from(textWhispsTable).where(eq(textWhispsTable.id, id)).then((r) => r[0]);
    expect(row.status).toBe("replied");
  });

  it("rejects a reply from an unrelated third party", async () => {
    const id = await createTextWhisp();
    await insertUser(USER_C);
    const res = await request(app).post(`/api/text-whisps/${id}/replies`).set(asUser(USER_C)).send({ replyText: "hi" });
    expect(res.status).toBe(404);
  });

  it("records the real authenticated replier as senderId, never client-controlled", async () => {
    const id = await createTextWhisp();
    const res = await request(app)
      .post(`/api/text-whisps/${id}/replies`)
      .set(asUser(USER_B))
      .send({ replyText: "hi", senderId: "someone-else" });

    const recipient = await getUser(USER_B);
    expect(res.body.senderId).toBe(recipient.id);

    const stored = await db.select().from(textWhispRepliesTable).where(eq(textWhispRepliesTable.id, res.body.id)).then((r) => r[0]);
    expect(stored.senderId).toBe(recipient.id);
  });
});

describe("Text Whisp reveal flow", () => {
  async function createTextWhisp() {
    await setupSenderAndVerifiedRecipient();
    const res = await request(app)
      .post("/api/text-whisps")
      .set(asUser(USER_A))
      .send({ recipientPhone: RECIPIENT_PHONE, messageText: "hi there" });
    return res.body.id as string;
  }

  it("lets the sender request a reveal", async () => {
    const id = await createTextWhisp();
    const res = await request(app).post(`/api/text-whisps/${id}/reveal`).set(asUser(USER_A));
    expect(res.status).toBe(200);
    expect(res.body.revealRequested).toBe(true);
    expect(res.body.revealAccepted).toBeNull();
  });

  it("rejects a reveal request from anyone other than the sender", async () => {
    const id = await createTextWhisp();
    const res = await request(app).post(`/api/text-whisps/${id}/reveal`).set(asUser(USER_B));
    expect(res.status).toBe(404);
  });

  it("rejects a respond before any reveal was requested", async () => {
    const id = await createTextWhisp();
    const res = await request(app).post(`/api/text-whisps/${id}/reveal/respond`).set(asUser(USER_B)).send({ accepted: true });
    expect(res.status).toBe(400);
  });

  it("lets the recipient accept a reveal request", async () => {
    const id = await createTextWhisp();
    await request(app).post(`/api/text-whisps/${id}/reveal`).set(asUser(USER_A));

    const res = await request(app).post(`/api/text-whisps/${id}/reveal/respond`).set(asUser(USER_B)).send({ accepted: true });
    expect(res.status).toBe(200);
    expect(res.body.revealAccepted).toBe(true);

    // Accepting only grants permission — it never injects the sender's real
    // identity anywhere on the row itself.
    const row = await db.select().from(textWhispsTable).where(eq(textWhispsTable.id, id)).then((r) => r[0]);
    expect(row.revealAccepted).toBe(true);
  });

  it("lets the recipient decline a reveal request", async () => {
    const id = await createTextWhisp();
    await request(app).post(`/api/text-whisps/${id}/reveal`).set(asUser(USER_A));

    const res = await request(app).post(`/api/text-whisps/${id}/reveal/respond`).set(asUser(USER_B)).send({ accepted: false });
    expect(res.status).toBe(200);
    expect(res.body.revealAccepted).toBe(false);
  });

  it("rejects a respond from anyone other than the recipient, including the sender", async () => {
    const id = await createTextWhisp();
    await request(app).post(`/api/text-whisps/${id}/reveal`).set(asUser(USER_A));

    const bySender = await request(app).post(`/api/text-whisps/${id}/reveal/respond`).set(asUser(USER_A)).send({ accepted: true });
    expect(bySender.status).toBe(404);

    await insertUser(USER_C);
    const byThirdParty = await request(app).post(`/api/text-whisps/${id}/reveal/respond`).set(asUser(USER_C)).send({ accepted: true });
    expect(byThirdParty.status).toBe(404);
  });

  it("rejects a reveal request while the recipient hasn't joined yet (recipientUserId null)", async () => {
    await insertUser(USER_A);
    const create = await request(app)
      .post("/api/text-whisps")
      .set(asUser(USER_A))
      .send({ recipientPhone: "+15550001111", messageText: "hi there" });
    expect(create.body.recipientUserId).toBeNull();

    const res = await request(app).post(`/api/text-whisps/${create.body.id}/reveal`).set(asUser(USER_A));
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/hasn't been opened by a registered recipient/i);

    const row = await db.select().from(textWhispsTable).where(eq(textWhispsTable.id, create.body.id)).then((r) => r[0]);
    expect(row.revealRequested).toBe(false);
  });
});

describe("Text Whisp sent to a non-user phone number", () => {
  async function createGuestTextWhisp() {
    await insertUser(USER_A);
    const res = await request(app)
      .post("/api/text-whisps")
      .set(asUser(USER_A))
      .send({ recipientPhone: "+15550002222", messageText: "hi there, stranger" });
    return res.body.id as string;
  }

  it("is only visible to the sender via the authenticated GET /:id route — there's no authenticated recipient yet", async () => {
    const id = await createGuestTextWhisp();

    const senderGet = await request(app).get(`/api/text-whisps/${id}`).set(asUser(USER_A));
    expect(senderGet.status).toBe(200);
    expect(senderGet.body.textWhisp.recipientUserId).toBeNull();

    await insertUser(USER_C);
    const thirdPartyGet = await request(app).get(`/api/text-whisps/${id}`).set(asUser(USER_C));
    expect(thirdPartyGet.status).toBe(404);
  });
});

describe("GET /api/public/text-whisps/:token", () => {
  async function createGuestTextWhisp() {
    await insertUser(USER_A);
    const res = await request(app)
      .post("/api/text-whisps")
      .set(asUser(USER_A))
      .send({ recipientPhone: "+15550003333", messageText: "a message for a stranger", senderAlias: "A friend" });
    return res.body as { id: string; publicToken: string };
  }

  it("returns only public-safe fields, never senderId/recipientUserId/recipientPhone", async () => {
    const { publicToken } = await createGuestTextWhisp();

    const res = await request(app).get(`/api/public/text-whisps/${publicToken}`);
    expect(res.status).toBe(200);
    expect(res.body.messageText).toBe("a message for a stranger");
    expect(res.body.senderAlias).toBe("A friend");
    expect(Object.keys(res.body).sort()).toEqual(["createdAt", "id", "messageText", "revealRequested", "senderAlias", "status"].sort());
  });

  it("marks the text whisp read on first guest view", async () => {
    const { id, publicToken } = await createGuestTextWhisp();

    const first = await request(app).get(`/api/public/text-whisps/${publicToken}`);
    expect(first.body.status).toBe("read");

    const row = await db.select().from(textWhispsTable).where(eq(textWhispsTable.id, id)).then((r) => r[0]);
    expect(row.readAt).not.toBeNull();
    expect(row.status).toBe("read");
  });

  it("404s on an unknown/expired token", async () => {
    const res = await request(app).get("/api/public/text-whisps/not-a-real-token");
    expect(res.status).toBe(404);
  });
});

describe("textWhispGuestSmsBody", () => {
  it("includes the guest URL and the required STOP/HELP compliance footer", () => {
    const body = textWhispGuestSmsBody("https://blindwhisper.com/tw/abc123");
    expect(body).toContain("https://blindwhisper.com/tw/abc123");
    expect(body).toContain("Reply STOP to opt out, HELP for help. Msg & data rates may apply.");
  });
});
