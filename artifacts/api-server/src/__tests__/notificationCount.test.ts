import { describe, it, expect } from "vitest";
import request from "supertest";
import app from "../app";
import { db, usersTable, notificationsTable, notificationReadsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { TEST_USER_HEADER } from "./setup";

const USER = "clerk_user_notification_count";

// Seeded per test, not in beforeAll: setup.ts truncates every table after
// each test, so shared fixtures survive exactly one of them.
async function seedHistory({ total, unreadOldest }: { total: number; unreadOldest: number }) {
  await request(app).get("/api/user/profile").set(TEST_USER_HEADER, USER);
  const user = await db.select().from(usersTable).where(eq(usersTable.clerkId, USER)).then((r) => r[0]);

  const ids: string[] = [];
  for (let i = 0; i < total; i++) {
    const id = randomUUID();
    ids.push(id);
    await db.insert(notificationsTable).values({
      id,
      targetUserId: user!.id,
      title: `Notification ${i}`,
      body: "body",
      url: null,
      createdByAdminId: null,
      // Oldest first, so ids[0] is the oldest and falls outside the list's
      // newest-50 window once there are more than 50.
      createdAt: new Date(Date.now() - (total - i) * 60_000),
    });
  }

  for (const id of ids.slice(unreadOldest)) {
    await db.insert(notificationReadsTable).values({
      id: randomUUID(),
      notificationId: id,
      userId: user!.id,
      readAt: new Date(),
    });
  }
}

// The bell's unread dot must answer "does this user have ANY unread
// notification". Two endpoints look like they answer that and they disagree
// once a user has history, so these pin which one is trustworthy — the bell
// used the wrong one and showed no dot to users who had unread notifications.
describe("unread notification count", () => {
  it("counts unread notifications that fall outside the list's 50-row window", async () => {
    await seedHistory({ total: 60, unreadOldest: 10 });

    const res = await request(app).get("/api/user/notifications/unread-count").set(TEST_USER_HEADER, USER);
    expect(res.status).toBe(200);
    expect(res.body.unreadCount).toBe(10);
  });

  it("does NOT get the same answer from the notification list, which is why the bell can't use it", async () => {
    await seedHistory({ total: 60, unreadOldest: 10 });

    // Regression guard, not an endorsement. The list derives unreadCount by
    // filtering the rows it returns and it returns at most 50; every row in
    // that window is read here, so it reports zero while ten unread
    // notifications exist. That is exactly how the bell went dark for a user
    // who had unread notifications.
    const res = await request(app).get("/api/user/notifications").set(TEST_USER_HEADER, USER);
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(50);
    expect(res.body.unreadCount).toBe(0);
  });

  it("agrees with the list when the history is short enough to fit in one page", async () => {
    await seedHistory({ total: 5, unreadOldest: 2 });

    const [list, count] = await Promise.all([
      request(app).get("/api/user/notifications").set(TEST_USER_HEADER, USER),
      request(app).get("/api/user/notifications/unread-count").set(TEST_USER_HEADER, USER),
    ]);
    expect(list.body.unreadCount).toBe(2);
    expect(count.body.unreadCount).toBe(2);
  });

  it("clears once everything is marked read", async () => {
    await seedHistory({ total: 60, unreadOldest: 10 });

    await request(app).post("/api/user/notifications/read-all").set(TEST_USER_HEADER, USER);

    const res = await request(app).get("/api/user/notifications/unread-count").set(TEST_USER_HEADER, USER);
    expect(res.body.unreadCount).toBe(0);
  });
});
