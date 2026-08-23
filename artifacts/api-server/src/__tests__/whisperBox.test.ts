import { describe, it, expect } from "vitest";
import { randomUUID } from "crypto";
import request from "supertest";
import app from "../app";
import { db, usersTable, whisperBoxMessagesTable, notificationsTable, moderationFlagsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { TEST_USER_HEADER } from "./setup";
import { adminHeaders } from "./adminTestUtils";

function asUser(clerkId: string) {
  return { [TEST_USER_HEADER]: clerkId };
}

async function ensureAndGet(clerkId: string) {
  const profile = await request(app).get("/api/user/profile").set(asUser(clerkId));
  return profile.body as { id: string; whispererHandle: string | null };
}

describe("Whisper Box", () => {
  it("a public resolve for an unknown handle and a disabled box return the identical 404", async () => {
    const clerkId = `clerk_wb_off_${randomUUID()}`;
    await ensureAndGet(clerkId); // account exists, box never enabled

    const unknown = await request(app).get(`/api/public/whisper-box/${randomUUID()}`);
    expect(unknown.status).toBe(404);

    // Enable it just long enough to grab the handle, then disable — the box
    // itself must go back to 404, not "handle exists, box off."
    const enabled = await request(app).post("/api/whisper-box/enable").set(asUser(clerkId));
    expect(enabled.status).toBe(200);
    const handle = enabled.body.handle as string;

    await request(app).post("/api/whisper-box/disable").set(asUser(clerkId));
    const disabled = await request(app).get(`/api/public/whisper-box/${handle}`);
    expect(disabled.status).toBe(404);
    expect(disabled.body).toEqual(unknown.body);
  });

  it("enable lazily assigns a whispererHandle and is idempotent", async () => {
    const clerkId = `clerk_wb_enable_${randomUUID()}`;
    const before = await ensureAndGet(clerkId);
    expect(before.whispererHandle).toBeNull();

    const first = await request(app).post("/api/whisper-box/enable").set(asUser(clerkId));
    expect(first.status).toBe(200);
    expect(first.body.enabled).toBe(true);
    expect(first.body.handle).toMatch(/^[A-Za-z]+[A-Za-z]+\d+$/);

    const second = await request(app).post("/api/whisper-box/enable").set(asUser(clerkId));
    expect(second.body.handle).toBe(first.body.handle); // same identity, not re-rolled

    const after = await ensureAndGet(clerkId);
    expect(after.whispererHandle).toBe(first.body.handle);
  });

  it("full flow: send (anonymous, no auth) → notifies recipient → appears unread → mark read → delete", async () => {
    const recipientClerkId = `clerk_wb_recipient_${randomUUID()}`;
    const recipient = await ensureAndGet(recipientClerkId);
    const enable = await request(app).post("/api/whisper-box/enable").set(asUser(recipientClerkId));
    const handle = enable.body.handle as string;

    // The send itself carries NO auth header at all — this is the one
    // deliberately anonymous-sender path in the app.
    const send = await request(app)
      .post(`/api/public/whisper-box/${handle}`)
      .send({ messageText: "You seem like a genuinely kind person.", senderAlias: "A fan" });
    expect(send.status).toBe(201);
    expect(send.body).toEqual({ ok: true }); // constant, minimal — no id leaked back

    const stored = await db.select().from(whisperBoxMessagesTable).where(eq(whisperBoxMessagesTable.recipientUserId, recipient.id)).then((r) => r[0]);
    expect(stored).toBeTruthy();
    expect(stored.status).toBe("unread");
    expect(stored.senderAlias).toBe("A fan");

    const notif = await db.select().from(notificationsTable).where(eq(notificationsTable.targetUserId, recipient.id)).then((r) => r[0]);
    expect(notif?.kind).toBe("whisper_box");

    const unreadCount = await request(app).get("/api/whisper-box/unread-count").set(asUser(recipientClerkId));
    expect(unreadCount.body.unreadCount).toBe(1);

    const list = await request(app).get("/api/whisper-box").set(asUser(recipientClerkId));
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0].messageText).toBe("You seem like a genuinely kind person.");

    const markRead = await request(app).post(`/api/whisper-box/${stored.id}/read`).set(asUser(recipientClerkId));
    expect(markRead.status).toBe(204);
    const afterRead = await request(app).get("/api/whisper-box/unread-count").set(asUser(recipientClerkId));
    expect(afterRead.body.unreadCount).toBe(0);

    const del = await request(app).delete(`/api/whisper-box/${stored.id}`).set(asUser(recipientClerkId));
    expect(del.status).toBe(204);
    const afterDelete = await request(app).get("/api/whisper-box").set(asUser(recipientClerkId));
    expect(afterDelete.body.items).toHaveLength(0);
  });

  it("a stranger can't read, mark-read, or delete someone else's inbox", async () => {
    const recipientClerkId = `clerk_wb_owner_${randomUUID()}`;
    const recipient = await ensureAndGet(recipientClerkId);
    const enable = await request(app).post("/api/whisper-box/enable").set(asUser(recipientClerkId));
    await request(app).post(`/api/public/whisper-box/${enable.body.handle}`).send({ messageText: "hi" });
    const stored = await db.select().from(whisperBoxMessagesTable).where(eq(whisperBoxMessagesTable.recipientUserId, recipient.id)).then((r) => r[0]);

    const strangerClerkId = `clerk_wb_stranger_${randomUUID()}`;
    await ensureAndGet(strangerClerkId);

    const strangerList = await request(app).get("/api/whisper-box").set(asUser(strangerClerkId));
    expect(strangerList.body.items).toHaveLength(0); // never leaks into someone else's inbox

    const strangerRead = await request(app).post(`/api/whisper-box/${stored.id}/read`).set(asUser(strangerClerkId));
    expect(strangerRead.status).toBe(404);

    const strangerDelete = await request(app).delete(`/api/whisper-box/${stored.id}`).set(asUser(strangerClerkId));
    expect(strangerDelete.status).toBe(404);
  });

  it("rejects a message over the 500-char cap and an empty message", async () => {
    const recipientClerkId = `clerk_wb_caps_${randomUUID()}`;
    await ensureAndGet(recipientClerkId);
    const enable = await request(app).post("/api/whisper-box/enable").set(asUser(recipientClerkId));

    const tooLong = await request(app).post(`/api/public/whisper-box/${enable.body.handle}`).send({ messageText: "x".repeat(501) });
    expect(tooLong.status).toBe(400);

    const empty = await request(app).post(`/api/public/whisper-box/${enable.body.handle}`).send({ messageText: "" });
    expect(empty.status).toBe(400);
  });

  it("a flagged message can be taken down by admin and disappears from the recipient's inbox", async () => {
    const recipientClerkId = `clerk_wb_flagged_${randomUUID()}`;
    const recipient = await ensureAndGet(recipientClerkId);
    const enable = await request(app).post("/api/whisper-box/enable").set(asUser(recipientClerkId));
    await request(app).post(`/api/public/whisper-box/${enable.body.handle}`).send({ messageText: "message pending moderation" });
    const message = await db.select().from(whisperBoxMessagesTable).where(eq(whisperBoxMessagesTable.recipientUserId, recipient.id)).then((r) => r[0]);

    // Moderation runs async off ANTHROPIC_API_KEY in real life (mocked in
    // tests) — simulate the flag it would have written, same as other
    // moderation tests in this suite do, and confirm the admin surface can
    // act on it end to end.
    await db.insert(moderationFlagsTable).values({
      id: randomUUID(),
      whisperBoxMessageId: message.id,
      contentType: "whisper_box_message",
      userId: null,
      severity: "high",
      reasoning: "test flag",
      source: "ai_classifier",
    });
    const flag = await db.select().from(moderationFlagsTable).where(eq(moderationFlagsTable.whisperBoxMessageId, message.id)).then((r) => r[0]);

    const adminClerkId = `clerk_wb_admin_${randomUUID()}`;
    const owner = await adminHeaders(adminClerkId, `${adminClerkId}@blindwhisper.com`);
    const flagsList = await request(app).get("/api/admin/moderation/flags").set(owner);
    expect(flagsList.body.items.some((f: any) => f.id === flag.id && f.whisperBoxMessageText === "message pending moderation")).toBe(true);

    const takedown = await request(app).post(`/api/admin/moderation/flags/${flag.id}/remove-content`).set(owner);
    expect(takedown.status).toBe(200);

    const afterTakedown = await request(app).get("/api/whisper-box").set(asUser(recipientClerkId));
    expect(afterTakedown.body.items).toHaveLength(0); // excludeRemoved() filters it out of the recipient's own inbox too
  });
});
