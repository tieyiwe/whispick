import { describe, it, expect, afterEach } from "vitest";
import request from "supertest";
import app from "../app";
import { TEST_USER_HEADER } from "./setup";

const ADMIN_CLERK_ID = "clerk_admin";
const ADMIN_EMAIL = `${ADMIN_CLERK_ID}@blindwhisper.com`;
const USER_A = "clerk_user_a";
const USER_B = "clerk_user_b";

function asUser(userId: string) {
  return { [TEST_USER_HEADER]: userId };
}

async function asAdmin() {
  process.env.ADMIN_EMAILS = ADMIN_EMAIL;
  // Any authenticated request runs ensureUser, which promotes on match.
  await request(app).get("/api/user/profile").set(asUser(ADMIN_CLERK_ID));
  return asUser(ADMIN_CLERK_ID);
}

afterEach(() => {
  delete process.env.ADMIN_EMAILS;
});

describe("Admin access control", () => {
  it("rejects unauthenticated requests", async () => {
    const res = await request(app).get("/api/admin/users");
    expect(res.status).toBe(401);
  });

  it("rejects a signed-in non-admin user", async () => {
    const res = await request(app).get("/api/admin/users").set(asUser(USER_A));
    expect(res.status).toBe(403);
  });

  it("promotes a user whose email matches ADMIN_EMAILS", async () => {
    const adminHeaders = await asAdmin();
    const res = await request(app).get("/api/admin/users").set(adminHeaders);
    expect(res.status).toBe(200);
  });
});

describe("Admin: users", () => {
  it("lists and searches users", async () => {
    const adminHeaders = await asAdmin();
    await request(app).get("/api/user/profile").set(asUser(USER_A));
    await request(app).get("/api/user/profile").set(asUser(USER_B));

    const all = await request(app).get("/api/admin/users").set(adminHeaders);
    expect(all.status).toBe(200);
    expect(all.body.total).toBeGreaterThanOrEqual(3);

    const searched = await request(app).get(`/api/admin/users?search=${USER_A}`).set(adminHeaders);
    expect(searched.body.items.some((u: any) => u.email.includes(USER_A))).toBe(true);
  });

  it("updates a user's plan, role, and credits", async () => {
    const adminHeaders = await asAdmin();
    const profile = await request(app).get("/api/user/profile").set(asUser(USER_A));
    const userId = profile.body.id;

    const updated = await request(app)
      .patch(`/api/admin/users/${userId}`)
      .set(adminHeaders)
      .send({ plan: "ember", boostCredits: 5 });

    expect(updated.status).toBe(200);
    expect(updated.body.plan).toBe("ember");
    expect(updated.body.boostCredits).toBe(5);
  });

  it("bans a user, and the banned user is then rejected everywhere else", async () => {
    const adminHeaders = await asAdmin();
    const profile = await request(app).get("/api/user/profile").set(asUser(USER_A));
    const userId = profile.body.id;

    const banned = await request(app).patch(`/api/admin/users/${userId}`).set(adminHeaders).send({ banned: true });
    expect(banned.status).toBe(200);
    expect(banned.body.banned).toBe(true);

    const blocked = await request(app).get("/api/whisps").set(asUser(USER_A));
    expect(blocked.status).toBe(403);
  });

  it("refuses to let an admin ban or demote their own account", async () => {
    const adminHeaders = await asAdmin();
    const me = await request(app).get("/api/user/profile").set(adminHeaders);

    const selfBan = await request(app).patch(`/api/admin/users/${me.body.id}`).set(adminHeaders).send({ banned: true });
    expect(selfBan.status).toBe(400);

    const selfDemote = await request(app).patch(`/api/admin/users/${me.body.id}`).set(adminHeaders).send({ role: "user" });
    expect(selfDemote.status).toBe(400);
  });

  it("refuses to let an admin delete their own account", async () => {
    const adminHeaders = await asAdmin();
    const me = await request(app).get("/api/user/profile").set(adminHeaders);

    const res = await request(app).delete(`/api/admin/users/${me.body.id}`).set(adminHeaders);
    expect(res.status).toBe(400);
  });

  it("deletes a user and cascades their whisps", async () => {
    const adminHeaders = await asAdmin();
    const profile = await request(app).get("/api/user/profile").set(asUser(USER_A));
    const userId = profile.body.id;

    await request(app)
      .post("/api/whisps")
      .set(asUser(USER_A))
      .send({ videoUrl: "https://youtu.be/x", deliveryMethod: "circle_drop" });

    const deleted = await request(app).delete(`/api/admin/users/${userId}`).set(adminHeaders);
    expect(deleted.status).toBe(204);

    const detail = await request(app).get(`/api/admin/users/${userId}`).set(adminHeaders);
    expect(detail.status).toBe(404);
  });
});

describe("Admin: whisps", () => {
  it("lists whisps across all users with sender email attached", async () => {
    const adminHeaders = await asAdmin();
    await request(app)
      .post("/api/whisps")
      .set(asUser(USER_B))
      .send({ videoUrl: "https://youtu.be/abc", videoTitle: "A great workout", deliveryMethod: "circle_drop" });

    const res = await request(app).get("/api/admin/whisps").set(adminHeaders);
    expect(res.status).toBe(200);
    const item = res.body.items.find((w: any) => w.videoUrl === "https://youtu.be/abc");
    expect(item).toBeTruthy();
    expect(item.senderEmail).toContain(USER_B);
  });

  it("filters whisps by status and delivery method", async () => {
    const adminHeaders = await asAdmin();
    const res = await request(app).get("/api/admin/whisps?deliveryMethod=circle_drop&status=delivered").set(adminHeaders);
    expect(res.status).toBe(200);
    for (const item of res.body.items) {
      expect(item.deliveryMethod).toBe("circle_drop");
      expect(item.status).toBe("delivered");
    }
  });

  it("gets full whisp detail and deletes it", async () => {
    const adminHeaders = await asAdmin();
    const created = await request(app)
      .post("/api/whisps")
      .set(asUser(USER_A))
      .send({ videoUrl: "https://youtu.be/detail", deliveryMethod: "circle_drop" });
    const whispId = created.body.id;

    const detail = await request(app).get(`/api/admin/whisps/${whispId}`).set(adminHeaders);
    expect(detail.status).toBe(200);
    expect(detail.body.whisp.id).toBe(whispId);
    expect(Array.isArray(detail.body.categories)).toBe(true);

    const deleted = await request(app).delete(`/api/admin/whisps/${whispId}`).set(adminHeaders);
    expect(deleted.status).toBe(204);

    const gone = await request(app).get(`/api/admin/whisps/${whispId}`).set(adminHeaders);
    expect(gone.status).toBe(404);
  });
});

describe("Admin: stats", () => {
  it("returns overview stats", async () => {
    const adminHeaders = await asAdmin();
    const res = await request(app).get("/api/admin/stats/overview").set(adminHeaders);
    expect(res.status).toBe(200);
    expect(typeof res.body.totalUsers).toBe("number");
    expect(typeof res.body.totalWhisps).toBe("number");
    expect(Array.isArray(res.body.signupTrend)).toBe(true);
  });

  it("returns category stats", async () => {
    const adminHeaders = await asAdmin();
    const res = await request(app).get("/api/admin/stats/categories").set(adminHeaders);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.categories)).toBe(true);
  });

  it("returns delivery method stats", async () => {
    const adminHeaders = await asAdmin();
    const res = await request(app).get("/api/admin/stats/delivery-methods").set(adminHeaders);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.methods)).toBe(true);
  });

  it("returns location stats", async () => {
    const adminHeaders = await asAdmin();
    const res = await request(app).get("/api/admin/stats/locations").set(adminHeaders);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.byCountry)).toBe(true);
  });

  it("returns opportunities", async () => {
    const adminHeaders = await asAdmin();
    const res = await request(app).get("/api/admin/stats/opportunities").set(adminHeaders);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.insights)).toBe(true);
  });

  it("returns funnel stats, including the in-app-vs-Twilio phone match routing breakdown", async () => {
    const adminHeaders = await asAdmin();
    const res = await request(app).get("/api/admin/stats/funnel").set(adminHeaders);
    expect(res.status).toBe(200);
    expect(typeof res.body.funnel.sent).toBe("number");
    expect(Array.isArray(res.body.deliveryByChannel)).toBe(true);
    expect(typeof res.body.phoneMatchRouting.inApp).toBe("number");
    expect(typeof res.body.phoneMatchRouting.twilio).toBe("number");
    expect(typeof res.body.phoneMatchRouting.matchRate).toBe("number");
  });

  it("counts a matched whisper_link SMS send as in-app routing in the funnel stats", async () => {
    const { db, usersTable, deliveryAttemptsTable, whispsTable } = await import("@workspace/db");
    const { randomUUID } = await import("crypto");

    const recipientId = randomUUID();
    await db.insert(usersTable).values({
      id: recipientId,
      clerkId: `clerk_${recipientId}`,
      email: `${recipientId}@example.com`,
      phone: "+15559990000",
      phoneVerifiedAt: new Date(),
      plan: "free",
      boostCredits: 0,
      whisperLinksUsed: 0,
    });

    const whispId = randomUUID();
    await db.insert(whispsTable).values({
      id: whispId,
      senderId: recipientId,
      videoUrl: "https://youtu.be/x",
      deliveryMethod: "whisper_link",
      whisperChannel: "sms",
      recipientPhone: "+15559990000",
      status: "delivered",
      publicToken: randomUUID().replace(/-/g, ""),
    });
    await db.insert(deliveryAttemptsTable).values({
      id: randomUUID(),
      whispId,
      channel: "in_app",
      purpose: "whisper_link",
      toAddress: "+15559990000",
      success: true,
    });

    const adminHeaders = await asAdmin();
    const res = await request(app).get("/api/admin/stats/funnel").set(adminHeaders);
    expect(res.status).toBe(200);
    expect(res.body.phoneMatchRouting.inApp).toBeGreaterThanOrEqual(1);
  });
});
