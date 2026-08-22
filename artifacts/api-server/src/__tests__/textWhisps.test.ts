import { describe, it, expect } from "vitest";
import { randomUUID } from "crypto";
import request from "supertest";
import app from "../app";
import { db, usersTable, textWhispsTable, textWhispRepliesTable, notificationsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { TEST_USER_HEADER } from "./setup";
import { textWhispGuestSmsBody } from "../lib/sms";
import { getDueTextWhisps } from "../lib/textWhispScheduler";

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

// Same shape as setupSenderAndVerifiedRecipient, but with a fresh, uniquely
// generated clerk id pair each call instead of the fixed USER_A/USER_B
// reused by most of this file's tests. createTextWhispLimiter
// (lib/rateLimit.ts) caps POST /text-whisps at 30/hour PER AUTHENTICATED
// USER — that's in-memory middleware state, not touched by the afterEach DB
// truncate, so it accumulates across every test in this file that sends as
// USER_A regardless of pass/fail. A test that needs several of its own text
// whisps (rather than exercising USER_A/B's own established relationship)
// should use this instead, so it draws from its own separate budget rather
// than eating into USER_A's and starving whatever test happens to run after
// it in the same file.
async function setupFreshSenderAndVerifiedRecipient() {
  const senderClerkId = `clerk_text_whisp_fresh_sender_${randomUUID()}`;
  const recipientClerkId = `clerk_text_whisp_fresh_recipient_${randomUUID()}`;
  const senderId = await insertUser(senderClerkId);
  const recipientId = await insertUser(recipientClerkId, { phone: RECIPIENT_PHONE, phoneVerifiedAt: new Date() });
  return { senderClerkId, recipientClerkId, senderId, recipientId };
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
    expect(res.body.recipientPhone).toBe(RECIPIENT_PHONE);
    expect(res.body.publicToken).toBeTruthy();
    expect(res.body.messageText).toBe("You matter.");
    // ANTI-ENUMERATION: the sender's own response must never say whether the
    // number matched — see toResponse()'s comment in routes/textWhisps.ts.
    expect(res.body.recipientUserId).toBeUndefined();
    expect(res.body.viewerIsRecipient).toBe(false);

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
    expect(res.body.recipientPhone).toBe("+15550000000");
    expect(res.body.publicToken).toBeTruthy();
    expect(typeof res.body.publicToken).toBe("string");
    // Identical response shape to the matched case above — the sender can't
    // tell a match from a non-match apart from either response.
    expect(res.body.recipientUserId).toBeUndefined();
    expect(res.body.viewerIsRecipient).toBe(false);

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
    const row = await db.select().from(textWhispsTable).where(eq(textWhispsTable.id, res.body.id)).then((r) => r[0]);
    expect(row.recipientUserId).toBeNull();
  });

  it("never includes recipientUserId in any sender-facing response, whether matched or not (anti-enumeration)", async () => {
    // Dedicated users/phones rather than USER_A/USER_B — this test alone
    // makes 2 creates plus a list and a detail call, and USER_A's shared
    // createTextWhispLimiter budget is already exercised by every other
    // test above; reusing it here risks tripping the limiter for whichever
    // test runs after this one in the same file/process.
    const ENUM_SENDER = "clerk_text_whisp_enum_sender";
    const ENUM_RECIPIENT = "clerk_text_whisp_enum_recipient";
    const ENUM_RECIPIENT_PHONE = "+15557778888";
    await insertUser(ENUM_SENDER);
    const recipientId = await insertUser(ENUM_RECIPIENT, { phone: ENUM_RECIPIENT_PHONE, phoneVerifiedAt: new Date() });

    const matched = await request(app)
      .post("/api/text-whisps")
      .set(asUser(ENUM_SENDER))
      .send({ recipientPhone: ENUM_RECIPIENT_PHONE, messageText: "matched" });
    const unmatched = await request(app)
      .post("/api/text-whisps")
      .set(asUser(ENUM_SENDER))
      .send({ recipientPhone: "+15559998888", messageText: "unmatched" });

    for (const res of [matched, unmatched]) {
      expect("recipientUserId" in res.body).toBe(false);
    }

    const list = await request(app).get("/api/text-whisps").set(asUser(ENUM_SENDER));
    expect(list.status).toBe(200);
    for (const item of list.body) {
      expect("recipientUserId" in item).toBe(false);
    }

    const detail = await request(app).get(`/api/text-whisps/${matched.body.id}`).set(asUser(ENUM_SENDER));
    expect(detail.status).toBe(200);
    expect("recipientUserId" in detail.body.textWhisp).toBe(false);

    // Confirm the underlying DB rows genuinely did differ (matched vs not) —
    // the point isn't that matching never happens, only that the sender's
    // own API responses never reveal which one occurred.
    const matchedRow = await db.select().from(textWhispsTable).where(eq(textWhispsTable.id, matched.body.id)).then((r) => r[0]);
    const unmatchedRow = await db.select().from(textWhispsTable).where(eq(textWhispsTable.id, unmatched.body.id)).then((r) => r[0]);
    expect(matchedRow.recipientUserId).toBe(recipientId);
    expect(unmatchedRow.recipientUserId).toBeNull();
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

  it("quotes a valid parent reply from the same thread", async () => {
    const { senderClerkId, recipientClerkId } = await setupFreshSenderAndVerifiedRecipient();
    const create = await request(app)
      .post("/api/text-whisps")
      .set(asUser(senderClerkId))
      .send({ recipientPhone: RECIPIENT_PHONE, messageText: "hi there" });
    const id = create.body.id as string;

    const first = await request(app).post(`/api/text-whisps/${id}/replies`).set(asUser(recipientClerkId)).send({ replyText: "first" });

    const second = await request(app)
      .post(`/api/text-whisps/${id}/replies`)
      .set(asUser(senderClerkId))
      .send({ replyText: "answering", parentReplyId: first.body.id });

    expect(second.status).toBe(201);
    expect(second.body.parentReplyId).toBe(first.body.id);
  });

  it("degrades to an unquoted reply for a parentReplyId from a different thread", async () => {
    const { senderClerkId, recipientClerkId } = await setupFreshSenderAndVerifiedRecipient();
    async function sendTextWhisp() {
      const res = await request(app)
        .post("/api/text-whisps")
        .set(asUser(senderClerkId))
        .send({ recipientPhone: RECIPIENT_PHONE, messageText: "hi there" });
      return res.body.id as string;
    }
    const idA = await sendTextWhisp();
    const idB = await sendTextWhisp();
    const foreignReply = await request(app)
      .post(`/api/text-whisps/${idB}/replies`)
      .set(asUser(recipientClerkId))
      .send({ replyText: "elsewhere" });

    const res = await request(app)
      .post(`/api/text-whisps/${idA}/replies`)
      .set(asUser(senderClerkId))
      .send({ replyText: "hi", parentReplyId: foreignReply.body.id });

    expect(res.status).toBe(201);
    expect(res.body.parentReplyId).toBeNull();
  });

  it("marks the other party's replies read when the viewer opens the thread, never their own", async () => {
    const { senderClerkId, recipientClerkId } = await setupFreshSenderAndVerifiedRecipient();
    const create = await request(app)
      .post("/api/text-whisps")
      .set(asUser(senderClerkId))
      .send({ recipientPhone: RECIPIENT_PHONE, messageText: "hi there" });
    const id = create.body.id as string;

    const reply = await request(app).post(`/api/text-whisps/${id}/replies`).set(asUser(recipientClerkId)).send({ replyText: "hi" });

    const beforeOpen = await db.select().from(textWhispRepliesTable).where(eq(textWhispRepliesTable.id, reply.body.id)).then((r) => r[0]);
    expect(beforeOpen.readAt).toBeNull();

    await request(app).get(`/api/text-whisps/${id}`).set(asUser(senderClerkId));

    const afterOpen = await db.select().from(textWhispRepliesTable).where(eq(textWhispRepliesTable.id, reply.body.id)).then((r) => r[0]);
    expect(afterOpen.readAt).not.toBeNull();
  });

  it("never marks the viewer's own reply read from their own GET call", async () => {
    const { senderClerkId } = await setupFreshSenderAndVerifiedRecipient();
    const create = await request(app)
      .post("/api/text-whisps")
      .set(asUser(senderClerkId))
      .send({ recipientPhone: RECIPIENT_PHONE, messageText: "hi there" });
    const id = create.body.id as string;

    const ownReply = await request(app).post(`/api/text-whisps/${id}/replies`).set(asUser(senderClerkId)).send({ replyText: "from the sender" });

    await request(app).get(`/api/text-whisps/${id}`).set(asUser(senderClerkId));

    const row = await db.select().from(textWhispRepliesTable).where(eq(textWhispRepliesTable.id, ownReply.body.id)).then((r) => r[0]);
    expect(row.readAt).toBeNull();
  });
});

describe("Text Whisp typing indicator", () => {
  async function createTextWhisp() {
    const { senderClerkId, recipientClerkId } = await setupFreshSenderAndVerifiedRecipient();
    const res = await request(app)
      .post("/api/text-whisps")
      .set(asUser(senderClerkId))
      .send({ recipientPhone: RECIPIENT_PHONE, messageText: "hi there" });
    return { id: res.body.id as string, senderClerkId, recipientClerkId };
  }

  it("shows otherPartyTyping to the OTHER party only, never the pinger's own view", async () => {
    const { id, senderClerkId, recipientClerkId } = await createTextWhisp();
    const ping = await request(app).post(`/api/text-whisps/${id}/typing`).set(asUser(recipientClerkId));
    expect(ping.status).toBe(204);

    const senderView = await request(app).get(`/api/text-whisps/${id}`).set(asUser(senderClerkId));
    expect(senderView.body.textWhisp.otherPartyTyping).toBe(true);

    const recipientView = await request(app).get(`/api/text-whisps/${id}`).set(asUser(recipientClerkId));
    expect(recipientView.body.textWhisp.otherPartyTyping).toBe(false);
  });

  it("clears once the pinger actually sends their reply", async () => {
    const { id, senderClerkId, recipientClerkId } = await createTextWhisp();
    await request(app).post(`/api/text-whisps/${id}/typing`).set(asUser(recipientClerkId));
    await request(app).post(`/api/text-whisps/${id}/replies`).set(asUser(recipientClerkId)).send({ replyText: "here it is" });

    const senderView = await request(app).get(`/api/text-whisps/${id}`).set(asUser(senderClerkId));
    expect(senderView.body.textWhisp.otherPartyTyping).toBe(false);
  });

  it("rejects a typing ping from an unrelated third party", async () => {
    const { id } = await createTextWhisp();
    const outsiderClerkId = `clerk_text_whisp_outsider_${randomUUID()}`;
    await insertUser(outsiderClerkId);
    const res = await request(app).post(`/api/text-whisps/${id}/typing`).set(asUser(outsiderClerkId));
    expect(res.status).toBe(404);
  });

  it("rejects an unauthenticated typing ping", async () => {
    const { id } = await createTextWhisp();
    const res = await request(app).post(`/api/text-whisps/${id}/typing`);
    expect(res.status).toBe(401);
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
    const createdRow = await db.select().from(textWhispsTable).where(eq(textWhispsTable.id, create.body.id)).then((r) => r[0]);
    expect(createdRow.recipientUserId).toBeNull();

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
    expect("recipientUserId" in senderGet.body.textWhisp).toBe(false);
    expect(senderGet.body.textWhisp.viewerIsRecipient).toBe(false);

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

describe("Text Whisp scheduling", () => {
  it("schedules a future send instead of delivering immediately, and doesn't notify yet", async () => {
    const { senderClerkId, recipientId } = await setupFreshSenderAndVerifiedRecipient();
    const scheduledAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const res = await request(app)
      .post("/api/text-whisps")
      .set(asUser(senderClerkId))
      .send({ recipientPhone: RECIPIENT_PHONE, messageText: "later", scheduledAt });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe("scheduled");
    expect(res.body.scheduledAt).toBeTruthy();

    const row = await db.select().from(textWhispsTable).where(eq(textWhispsTable.id, res.body.id)).then((r) => r[0]);
    expect(row.status).toBe("scheduled");
    expect(row.scheduledAt).not.toBeNull();

    // No in-app notification fired yet — delivery is held back until due.
    const notifications = await db.select().from(notificationsTable).where(eq(notificationsTable.targetUserId, recipientId));
    expect(notifications.length).toBe(0);
  });

  it("rejects a schedule further out than the max window", async () => {
    const { senderClerkId } = await setupFreshSenderAndVerifiedRecipient();
    const farFuture = new Date(Date.now() + 400 * 24 * 60 * 60 * 1000).toISOString();
    const res = await request(app)
      .post("/api/text-whisps")
      .set(asUser(senderClerkId))
      .send({ recipientPhone: RECIPIENT_PHONE, messageText: "too far", scheduledAt: farFuture });

    expect(res.status).toBe(400);
  });

  it("treats a past scheduledAt as an immediate send", async () => {
    const { senderClerkId } = await setupFreshSenderAndVerifiedRecipient();
    const past = new Date(Date.now() - 60_000).toISOString();
    const res = await request(app)
      .post("/api/text-whisps")
      .set(asUser(senderClerkId))
      .send({ recipientPhone: RECIPIENT_PHONE, messageText: "already due", scheduledAt: past });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe("sent");
  });
});

describe("getDueTextWhisps", () => {
  it("only returns scheduled, due, non-deleted rows", async () => {
    const { senderId } = await setupFreshSenderAndVerifiedRecipient();
    const now = Date.now();

    // Inserted directly rather than through the route, so exact
    // status/scheduledAt/deletedBySenderAt combinations are controllable.
    const due = {
      id: randomUUID(), senderId, recipientPhone: "+15551110001", publicToken: randomUUID(),
      messageText: "due", status: "scheduled", scheduledAt: new Date(now - 60_000),
    };
    const notYetDue = {
      id: randomUUID(), senderId, recipientPhone: "+15551110002", publicToken: randomUUID(),
      messageText: "not yet", status: "scheduled", scheduledAt: new Date(now + 60_000),
    };
    const alreadySent = {
      id: randomUUID(), senderId, recipientPhone: "+15551110003", publicToken: randomUUID(),
      messageText: "already sent", status: "sent", scheduledAt: new Date(now - 60_000),
    };
    const deleted = {
      id: randomUUID(), senderId, recipientPhone: "+15551110004", publicToken: randomUUID(),
      messageText: "deleted", status: "scheduled", scheduledAt: new Date(now - 60_000), deletedBySenderAt: new Date(),
    };

    await db.insert(textWhispsTable).values([due, notYetDue, alreadySent, deleted]);

    const dueRows = await getDueTextWhisps();
    const dueIds = dueRows.map((r) => r.id);
    expect(dueIds).toContain(due.id);
    expect(dueIds).not.toContain(notYetDue.id);
    expect(dueIds).not.toContain(alreadySent.id);
    expect(dueIds).not.toContain(deleted.id);
  });
});
