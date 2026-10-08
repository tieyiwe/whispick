import { describe, it, expect, vi, beforeEach } from "vitest";
import { randomUUID } from "crypto";
import { db, usersTable, notificationsTable } from "@workspace/db";

const sendEmail = vi.fn(async () => true);
vi.mock("../lib/email", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/email")>()),
  sendEmail: (...args: unknown[]) => sendEmail(...(args as [])),
}));

const { emailReplyNotification } = await import("../lib/replyEmail");
const { scheduleDeferredNotification, dispatchDueDeferredNotifications } = await import("../lib/replyNotificationScheduler");

// "Someone replied" emails: on by default, off via the Settings switch,
// and one per burst of replies on a thread rather than one per message.

async function insertUser(overrides: Partial<typeof usersTable.$inferInsert> = {}) {
  const id = overrides.id ?? randomUUID();
  const clerkId = overrides.clerkId ?? `clerk_reply_email_${id}`;
  const email = overrides.email ?? `${id}@example.com`;
  await db.insert(usersTable).values({ plan: "free", boostCredits: 0, whisperLinksUsed: 0, ...overrides, id, clerkId, email });
  return { id, clerkId, email };
}

async function insertReplyNotification(userId: string, path: string, createdAt = new Date()) {
  const id = randomUUID();
  await db.insert(notificationsTable).values({ id, targetUserId: userId, title: "t", body: "b", url: path, kind: "reply", createdAt });
  return id;
}

const base = {
  subject: "Someone replied",
  heading: "You got a reply",
  text: "Someone replied anonymously.",
  kind: "reply",
  purpose: "text_whisp_reply" as const,
};

beforeEach(() => {
  sendEmail.mockClear();
});

describe("emailReplyNotification", () => {
  it("emails by default, linking to the thread and to Settings", async () => {
    const user = await insertUser();
    const path = `/text-whisps/${randomUUID()}`;
    await insertReplyNotification(user.id, path);

    expect(await emailReplyNotification(user.id, { ...base, path })).toBe(true);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    const [to, , html] = sendEmail.mock.calls[0] as unknown as [string, string, string];
    expect(to).toBe(user.email);
    expect(html).toContain(path);
    expect(html).toContain("/settings");
  });

  it("respects the Settings opt-out", async () => {
    const user = await insertUser({ emailNotificationsEnabled: false });
    const path = `/text-whisps/${randomUUID()}`;
    await insertReplyNotification(user.id, path);

    expect(await emailReplyNotification(user.id, { ...base, path })).toBe(false);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("skips placeholder addresses and banned accounts", async () => {
    const placeholderId = randomUUID();
    const placeholder = await insertUser({ id: placeholderId, clerkId: "clerk_ph_" + placeholderId, email: `clerk_ph_${placeholderId}@placeholder.invalid` });
    const banned = await insertUser({ banned: true });
    for (const user of [placeholder, banned]) {
      const path = `/text-whisps/${randomUUID()}`;
      await insertReplyNotification(user.id, path);
      expect(await emailReplyNotification(user.id, { ...base, path })).toBe(false);
    }
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("sends one email per burst of replies on the same thread", async () => {
    const user = await insertUser();
    const path = `/text-whisps/${randomUUID()}`;

    await insertReplyNotification(user.id, path);
    expect(await emailReplyNotification(user.id, { ...base, path })).toBe(true);

    // A second reply minutes later: in-app only.
    await insertReplyNotification(user.id, path);
    expect(await emailReplyNotification(user.id, { ...base, path })).toBe(false);

    // A different thread isn't throttled by the first.
    const other = `/text-whisps/${randomUUID()}`;
    await insertReplyNotification(user.id, other);
    expect(await emailReplyNotification(user.id, { ...base, path: other })).toBe(true);
    expect(sendEmail).toHaveBeenCalledTimes(2);
  });

  it("emails again once the thread has been quiet past the cooldown", async () => {
    const user = await insertUser();
    const path = `/text-whisps/${randomUUID()}`;
    await insertReplyNotification(user.id, path, new Date(Date.now() - 2 * 60 * 60 * 1000));
    await insertReplyNotification(user.id, path);
    expect(await emailReplyNotification(user.id, { ...base, path })).toBe(true);
  });
});

describe("deferred comment replies", () => {
  it("email the comment author when the deferred notification is released", async () => {
    const user = await insertUser();
    const path = `/dt/${randomUUID()}`;
    await scheduleDeferredNotification(user.id, "New reply to your comment 💬", "Someone replied.", path, "debate_comment_reply");
    // Make it due now.
    await db.update(notificationsTable).set({ deliverAfter: new Date(Date.now() - 1000) });

    await dispatchDueDeferredNotifications();
    await vi.waitFor(() => expect(sendEmail).toHaveBeenCalledTimes(1));
    const [to, subject] = sendEmail.mock.calls[0] as unknown as [string, string];
    expect(to).toBe(user.email);
    expect(subject).toBe("Someone replied to your comment");
  });

  it("don't email for non-reply deferred kinds", async () => {
    const user = await insertUser();
    await scheduleDeferredNotification(user.id, "Opened", "Someone opened it.", `/whisps/${randomUUID()}`, "opened");
    await db.update(notificationsTable).set({ deliverAfter: new Date(Date.now() - 1000) });

    await dispatchDueDeferredNotifications();
    await new Promise((r) => setTimeout(r, 50));
    expect(sendEmail).not.toHaveBeenCalled();
  });
});
