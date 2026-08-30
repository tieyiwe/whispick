import { describe, it, expect } from "vitest";
import { randomUUID } from "crypto";
import request from "supertest";
import app from "../app";
import { db, notificationsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { TEST_USER_HEADER, clerkGetUserMock } from "./setup";

function asUser(clerkId: string) {
  return { [TEST_USER_HEADER]: clerkId };
}

// notifyAdminsOfNewSignup/notifyAdminsOfNewDebateTopic (lib/adminNotify.ts)
// are fired with `void` from ensureUser.ts/debateTopics.ts — the request
// that triggers them must not wait on the notification write. A short delay
// before asserting DB state is the same pattern bugRabbit/suggestions'
// fire-and-forget moderation tests already use.
async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 50));
}

async function makeAdmin(clerkId: string, email: string): Promise<string> {
  process.env.ADMIN_EMAILS = email;
  try {
    clerkGetUserMock.mockResolvedValueOnce({
      twoFactorEnabled: true,
      emailAddresses: [{ id: "em_1", emailAddress: email }],
      primaryEmailAddressId: "em_1",
      phoneNumbers: [],
      firstName: "Admin",
      lastName: "One",
    } as any);
    const res = await request(app).get("/api/user/profile").set(asUser(clerkId));
    expect(res.body.role).toBe("admin");
    return res.body.id as string;
  } finally {
    delete process.env.ADMIN_EMAILS;
  }
}

describe("admin notifications: new signup", () => {
  it("notifies an admin (with the toggle on) when a new user signs up", async () => {
    const adminId = await makeAdmin(`clerk_signup_admin_${randomUUID()}`, "signup-admin@example.com");

    await request(app).get("/api/user/profile").set(asUser(`clerk_signup_newuser_${randomUUID()}`));
    await settle();

    const rows = await db.select().from(notificationsTable).where(eq(notificationsTable.targetUserId, adminId));
    const signupNotifications = rows.filter((r) => r.kind === "admin_new_signup");
    expect(signupNotifications.length).toBe(1);
    expect(signupNotifications[0].title).toContain("New user joined");
  });

  it("does not notify an admin who turned the toggle off", async () => {
    const adminClerkId = `clerk_signup_admin_off_${randomUUID()}`;
    const adminId = await makeAdmin(adminClerkId, "signup-admin-off@example.com");

    // Toggle off as the admin themselves.
    await request(app).patch("/api/user/profile").set(asUser(adminClerkId)).send({ notifyOnNewSignup: false });

    await request(app).get("/api/user/profile").set(asUser(`clerk_signup_newuser_off_${randomUUID()}`));
    await settle();

    const rows = await db.select().from(notificationsTable).where(eq(notificationsTable.targetUserId, adminId));
    expect(rows.filter((r) => r.kind === "admin_new_signup")).toHaveLength(0);
  });
});

describe("admin notifications: new debate topic", () => {
  it("notifies an admin when a user posts a new debate topic", async () => {
    const adminId = await makeAdmin(`clerk_topic_admin_${randomUUID()}`, "topic-admin@example.com");

    const posterClerkId = `clerk_topic_poster_${randomUUID()}`;
    await request(app).get("/api/user/profile").set(asUser(posterClerkId));
    const postRes = await request(app)
      .post("/api/debate-topics")
      .set(asUser(posterClerkId))
      .send({ topicText: "Is honesty always the best policy?" });
    expect(postRes.status).toBe(201);
    await settle();

    const rows = await db.select().from(notificationsTable).where(eq(notificationsTable.targetUserId, adminId));
    const topicNotifications = rows.filter((r) => r.kind === "admin_new_debate_topic");
    expect(topicNotifications.length).toBe(1);
    expect(topicNotifications[0].title).toContain("New Debate Now post");
    expect(topicNotifications[0].url).toBe(`/debate-topics/${postRes.body.id}`);
  });

  it("does not self-notify when an admin posts their own debate topic", async () => {
    const adminClerkId = `clerk_topic_self_admin_${randomUUID()}`;
    const adminId = await makeAdmin(adminClerkId, "topic-self-admin@example.com");

    await request(app).post("/api/debate-topics").set(asUser(adminClerkId)).send({ topicText: "Am I my own audience?" });
    await settle();

    const rows = await db.select().from(notificationsTable).where(eq(notificationsTable.targetUserId, adminId));
    expect(rows.filter((r) => r.kind === "admin_new_debate_topic")).toHaveLength(0);
  });
});
