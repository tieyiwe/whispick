import { describe, it, expect } from "vitest";
import { randomUUID } from "crypto";
import request from "supertest";
import app from "../app";
import { db, usersTable, whispsTable, debateTopicsTable, followsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { TEST_USER_HEADER } from "./setup";

function asUser(clerkId: string) {
  return { [TEST_USER_HEADER]: clerkId };
}

async function ensureAndGet(clerkId: string) {
  const profile = await request(app).get("/api/user/profile").set(asUser(clerkId));
  return profile.body as { id: string; createdAt: string };
}

describe("GET /api/user/recap", () => {
  it("defaults to all_time and reports real, zeroed-out stats for a brand-new account", async () => {
    const clerkId = `clerk_recap_new_${randomUUID()}`;
    const user = await ensureAndGet(clerkId);

    const res = await request(app).get("/api/user/recap").set(asUser(clerkId));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      period: "all_time",
      totalSent: 0,
      totalReceived: 0,
      repliesReceived: 0,
      circlePosts: 0,
      debateTopicsPosted: 0,
      followerCount: 0,
      whisperBoxMessagesReceived: null, // box never enabled
      topCategory: null,
    });
    expect(new Date(res.body.memberSince).getTime()).toBe(new Date(user.createdAt).getTime());
  });

  it("counts real activity: sent whisps, circle posts, debate topics, followers", async () => {
    const clerkId = `clerk_recap_active_${randomUUID()}`;
    const user = await ensureAndGet(clerkId);

    // Two Whisper Links and one Circle Drop, all sent by this account.
    await db.insert(whispsTable).values([
      {
        id: randomUUID(),
        senderId: user.id,
        deliveryMethod: "whisper_link",
        whisperChannel: "email",
        recipientEmail: "a@example.com",
        videoUrl: "https://youtu.be/dQw4w9WgXcQ",
        videoPlatform: "youtube",
        status: "delivered",
        publicToken: randomUUID(),
      },
      {
        id: randomUUID(),
        senderId: user.id,
        deliveryMethod: "whisper_link",
        whisperChannel: "email",
        recipientEmail: "b@example.com",
        videoUrl: "https://youtu.be/dQw4w9WgXcQ",
        videoPlatform: "youtube",
        status: "delivered",
        publicToken: randomUUID(),
      },
      {
        id: randomUUID(),
        senderId: user.id,
        deliveryMethod: "circle_drop",
        videoUrl: "https://youtu.be/dQw4w9WgXcQ",
        videoPlatform: "youtube",
        status: "delivered",
        publicToken: randomUUID(),
      },
    ]);

    await db.insert(debateTopicsTable).values({ id: randomUUID(), authorId: user.id, topicText: "Is pineapple on pizza acceptable?" });

    const followerClerkId = `clerk_recap_follower_${randomUUID()}`;
    const follower = await ensureAndGet(followerClerkId);
    await db.insert(followsTable).values({ id: randomUUID(), followerUserId: follower.id, followedUserId: user.id });

    const res = await request(app).get("/api/user/recap").set(asUser(clerkId));
    expect(res.status).toBe(200);
    expect(res.body.totalSent).toBe(3); // all three deliveryMethods count as "sent"
    expect(res.body.circlePosts).toBe(1);
    expect(res.body.debateTopicsPosted).toBe(1);
    expect(res.body.followerCount).toBe(1);
  });

  it("last_30_days excludes older activity that all_time includes", async () => {
    const clerkId = `clerk_recap_period_${randomUUID()}`;
    const user = await ensureAndGet(clerkId);

    const oldWhispId = randomUUID();
    await db.insert(whispsTable).values({
      id: oldWhispId,
      senderId: user.id,
      deliveryMethod: "whisper_link",
      whisperChannel: "email",
      recipientEmail: "old@example.com",
      videoUrl: "https://youtu.be/dQw4w9WgXcQ",
      videoPlatform: "youtube",
      status: "delivered",
      publicToken: randomUUID(),
    });
    await db.update(whispsTable).set({ createdAt: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000) }).where(eq(whispsTable.id, oldWhispId));

    const allTime = await request(app).get("/api/user/recap").set(asUser(clerkId));
    expect(allTime.body.totalSent).toBe(1);

    const last30 = await request(app).get("/api/user/recap?period=last_30_days").set(asUser(clerkId));
    expect(last30.body.period).toBe("last_30_days");
    expect(last30.body.totalSent).toBe(0);
  });

  it("only reports Whisper Box stats once the account has enabled it", async () => {
    const clerkId = `clerk_recap_wb_${randomUUID()}`;
    await ensureAndGet(clerkId);

    const beforeEnable = await request(app).get("/api/user/recap").set(asUser(clerkId));
    expect(beforeEnable.body.whisperBoxMessagesReceived).toBeNull();

    const enable = await request(app).post("/api/whisper-box/enable").set(asUser(clerkId));
    await request(app).post(`/api/public/whisper-box/${enable.body.handle}`).send({ messageText: "hello!" });

    const afterEnable = await request(app).get("/api/user/recap").set(asUser(clerkId));
    expect(afterEnable.body.whisperBoxMessagesReceived).toBe(1);
  });

  it("rejects an unrecognized period value by falling back to all_time rather than erroring", async () => {
    const clerkId = `clerk_recap_badperiod_${randomUUID()}`;
    await ensureAndGet(clerkId);
    const res = await request(app).get("/api/user/recap?period=nonsense").set(asUser(clerkId));
    expect(res.status).toBe(200);
    expect(res.body.period).toBe("all_time");
  });
});
