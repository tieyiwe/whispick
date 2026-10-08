import { describe, it, expect } from "vitest";
import request from "supertest";
import app from "../app";
import { TEST_USER_HEADER } from "./setup";
import { adminHeaders } from "./adminTestUtils";
import { db, usersTable, followsTable, notificationsTable, featureEventsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";

const OWNER_CLERK_ID = "clerk_presence_owner";
const OWNER_EMAIL = `${OWNER_CLERK_ID}@blindwhisper.com`;

function asUser(userId: string) {
  return { [TEST_USER_HEADER]: userId };
}

async function asOwner() {
  return adminHeaders(OWNER_CLERK_ID, OWNER_EMAIL);
}

async function signIn(clerkId: string) {
  const res = await request(app).get("/api/user/profile").set(asUser(clerkId));
  return res.body;
}

async function createTopic(clerkId: string, topicText = "Is honesty always the best policy?") {
  return request(app).post("/api/debate-topics").set(asUser(clerkId)).send({ topicText });
}

async function follow(followerClerkId: string, handle: string) {
  return request(app).post("/api/follows").set(asUser(followerClerkId)).send({ handle });
}

// ---------------------------------------------------------------------------
// GET /api/follows/online-status
// ---------------------------------------------------------------------------

describe("GET /api/follows/online-status", () => {
  it("requires auth", async () => {
    const res = await request(app).get("/api/follows/online-status");
    expect(res.status).toBe(401);
  });

  it("a viewer with visibility off gets an empty map even if they follow someone online", async () => {
    const viewerId = `clerk_presence_viewer_off_${randomUUID()}`;
    const followedId = `clerk_presence_followed_a_${randomUUID()}`;

    const topic = await createTopic(followedId);
    expect(topic.status).toBe(201);
    const followRes = await follow(viewerId, topic.body.authorHandle);
    expect(followRes.status).toBe(200);

    const off = await request(app).patch("/api/user/profile").set(asUser(viewerId)).send({ showOnlineStatus: false });
    expect(off.body.showOnlineStatus).toBe(false);

    const res = await request(app).get("/api/follows/online-status").set(asUser(viewerId));
    expect(res.status).toBe(200);
    expect(res.body.online).toEqual({});
  });

  it("excludes a followed account whose own visibility is off", async () => {
    const viewerId = `clerk_presence_viewer_b_${randomUUID()}`;
    const followedId = `clerk_presence_followed_b_${randomUUID()}`;

    const topic = await createTopic(followedId);
    await request(app).patch("/api/user/profile").set(asUser(followedId)).send({ showOnlineStatus: false });
    await follow(viewerId, topic.body.authorHandle);

    const res = await request(app).get("/api/follows/online-status").set(asUser(viewerId));
    expect(res.status).toBe(200);
    expect(res.body.online[topic.body.authorHandle]).toBeUndefined();
    expect(Object.keys(res.body.online)).toHaveLength(0);
  });

  it("shows a followed, recently-active account as online when both sides allow it", async () => {
    const viewerId = `clerk_presence_viewer_c_${randomUUID()}`;
    const followedId = `clerk_presence_followed_c_${randomUUID()}`;

    // First sign-in for both: lastSeenAt is set synchronously on the insert
    // path (see ensureUser.ts), so the followed account is guaranteed to be
    // within the 5-minute window without racing the fire-and-forget update
    // used on the existing-user path.
    await signIn(viewerId);
    const topic = await createTopic(followedId);
    expect(topic.status).toBe(201);
    await follow(viewerId, topic.body.authorHandle);

    const res = await request(app).get("/api/follows/online-status").set(asUser(viewerId));
    expect(res.status).toBe(200);
    expect(res.body.online).toEqual({ [topic.body.authorHandle]: true });
  });

  it("excludes an account with no whispererHandle yet entirely — not present, not null", async () => {
    const viewerId = `clerk_presence_viewer_d_${randomUUID()}`;
    const handlelessId = `clerk_presence_handleless_${randomUUID()}`;

    const viewer = await signIn(viewerId);
    const handleless = await signIn(handlelessId);
    expect(handleless.whispererHandle).toBeNull();

    // Never posted a topic or comment, so has no whispererHandle — follow it
    // straight in the DB (the public follow endpoint can only resolve a
    // handle, and this account has none) to exercise the route's own guard.
    await db.insert(followsTable).values({ id: randomUUID(), followerUserId: viewer.id, followedUserId: handleless.id });

    const res = await request(app).get("/api/follows/online-status").set(asUser(viewerId));
    expect(res.status).toBe(200);
    expect(res.body.online).toEqual({});
    expect(Object.values(res.body.online)).not.toContain(null);
  });
});

// ---------------------------------------------------------------------------
// Admin: users compliance + online fields
// ---------------------------------------------------------------------------

describe("GET /api/admin/users — compliance additions", () => {
  it("each item carries a compliance object and an online boolean", async () => {
    const owner = await asOwner();
    const marker = randomUUID();
    const clerkId = `clerk_compliance_struct_${marker}`;
    await signIn(clerkId);

    const res = await request(app).get("/api/admin/users").set(owner).query({ search: marker });
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    const item = res.body.items[0];
    expect(typeof item.online).toBe("boolean");
    expect(item.compliance).toMatchObject({
      emailVerified: expect.any(Boolean),
      phoneVerified: expect.any(Boolean),
      policyUpToDate: expect.any(Boolean),
    });
    expect([true, false, null]).toContain(item.compliance.mfaEnabled);
  });

  it("the compliance=mfa_missing filter narrows to only the account missing it", async () => {
    const owner = await asOwner();
    const marker = randomUUID();
    const clerkWithMfa = `clerk_mfa_has_${marker}`;
    const clerkWithoutMfa = `clerk_mfa_missing_${marker}`;

    const withMfa = await signIn(clerkWithMfa);
    const withoutMfa = await signIn(clerkWithoutMfa);
    // Both were created with the default mocked twoFactorEnabled: true (see
    // setup.ts). Flip one back off directly — a raw DB write, not another
    // sign-in — so we never risk ensureUser's background Clerk-mirror sync
    // (lib/ensureUser.ts's maybeSyncTwoFactorStatus) racing in and undoing it.
    await db.update(usersTable).set({ twoFactorEnabled: false }).where(eq(usersTable.id, withoutMfa.id));

    const unfiltered = await request(app).get("/api/admin/users").set(owner).query({ search: marker });
    expect(unfiltered.body.items).toHaveLength(2);

    const filtered = await request(app).get("/api/admin/users").set(owner).query({ search: marker, compliance: "mfa_missing" });
    expect(filtered.status).toBe(200);
    expect(filtered.body.items).toHaveLength(1);
    expect(filtered.body.items[0].id).toBe(withoutMfa.id);
    expect(filtered.body.items[0].compliance.mfaEnabled).not.toBe(true);
    expect(filtered.body.items.some((u: any) => u.id === withMfa.id)).toBe(false);
  });
});

describe("GET /api/admin/users/:id — compliance additions", () => {
  it("carries the same compliance object and online boolean on the single-user response", async () => {
    const owner = await asOwner();
    const clerkId = `clerk_compliance_detail_${randomUUID()}`;
    const user = await signIn(clerkId);

    const res = await request(app).get(`/api/admin/users/${user.id}`).set(owner);
    expect(res.status).toBe(200);
    expect(typeof res.body.user.online).toBe("boolean");
    expect(res.body.user.compliance).toMatchObject({
      emailVerified: expect.any(Boolean),
      phoneVerified: expect.any(Boolean),
      policyUpToDate: expect.any(Boolean),
    });
    expect([true, false, null]).toContain(res.body.user.compliance.mfaEnabled);
  });
});

describe("GET /api/admin/users/online-now", () => {
  it("returns onlineCount and windowMinutes, and counts a just-signed-in user", async () => {
    const owner = await asOwner();

    const before = await request(app).get("/api/admin/users/online-now").set(owner);
    expect(before.status).toBe(200);
    expect(typeof before.body.onlineCount).toBe("number");
    expect(before.body.windowMinutes).toBe(5);

    // A brand-new sign-in sets lastSeenAt synchronously on the insert path.
    await signIn(`clerk_online_now_${randomUUID()}`);

    const after = await request(app).get("/api/admin/users/online-now").set(owner);
    expect(after.body.onlineCount).toBeGreaterThanOrEqual(before.body.onlineCount + 1);
  });
});

describe("POST /api/admin/users/compliance-reminder", () => {
  it("sends a reminder, returning delivery counts and persisting a notification", async () => {
    const owner = await asOwner();
    const target = await signIn(`clerk_reminder_target_${randomUUID()}`);

    const res = await request(app)
      .post("/api/admin/users/compliance-reminder")
      .set(owner)
      .send({ userIds: [target.id], kind: "mfa_missing" });

    expect(res.status).toBe(201);
    expect(res.body.recipientCount).toBe(1);
    expect(typeof res.body.pushDelivered).toBe("number");
    expect(typeof res.body.emailsSent).toBe("number");
    expect(typeof res.body.emailsSkipped).toBe("number");

    const notifs = await db.select().from(notificationsTable).where(eq(notificationsTable.targetUserId, target.id));
    expect(notifs).toHaveLength(1);
    expect(notifs[0]!.title).toBe("Turn on two-factor authentication");
  });

  it("rejects an empty userIds array", async () => {
    const owner = await asOwner();
    const res = await request(app).post("/api/admin/users/compliance-reminder").set(owner).send({ userIds: [], kind: "mfa_missing" });
    expect(res.status).toBe(400);
  });

  it("rejects a userIds-less request", async () => {
    const owner = await asOwner();
    const res = await request(app).post("/api/admin/users/compliance-reminder").set(owner).send({ kind: "mfa_missing" });
    expect(res.status).toBe(400);
  });

  it("rejects an invalid kind", async () => {
    const owner = await asOwner();
    const target = await signIn(`clerk_reminder_badkind_${randomUUID()}`);
    const res = await request(app)
      .post("/api/admin/users/compliance-reminder")
      .set(owner)
      .send({ userIds: [target.id], kind: "not_a_real_kind" });
    expect(res.status).toBe(400);
  });
});

describe("GET /api/admin/analytics/traffic-by-hour", () => {
  it("returns a 24-item hours array covering 0-23 with peakHour/days, empty when there's no data", async () => {
    const owner = await asOwner();
    const res = await request(app).get("/api/admin/analytics/traffic-by-hour").set(owner);
    expect(res.status).toBe(200);
    expect(res.body.hours).toHaveLength(24);
    res.body.hours.forEach((h: any, i: number) => {
      expect(h.hour).toBe(i);
      expect(typeof h.count).toBe("number");
    });
    expect(res.body.peakHour).toBeNull();
    expect(res.body.days).toBe(30);
  });

  it("reflects real feature_events activity in the histogram", async () => {
    const owner = await asOwner();
    await db.insert(featureEventsTable).values({ id: randomUUID(), feature: "test_feature", userId: null, count: 7, createdAt: new Date() });

    const res = await request(app).get("/api/admin/analytics/traffic-by-hour").set(owner).query({ days: 7 });
    expect(res.status).toBe(200);
    const total = res.body.hours.reduce((sum: number, h: any) => sum + h.count, 0);
    expect(total).toBe(7);
    expect(res.body.peakHour).not.toBeNull();
    const peakEntry = res.body.hours.find((h: any) => h.hour === res.body.peakHour);
    expect(peakEntry.count).toBe(7);
    expect(res.body.days).toBe(7);
  });
});
