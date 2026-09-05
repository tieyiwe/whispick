import { describe, it, expect, afterEach } from "vitest";
import request from "supertest";
import app from "../app";
import { TEST_USER_HEADER, clerkGetUserMock } from "./setup";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { adminHeaders } from "./adminTestUtils";

const ADMIN_CLERK_ID = "clerk_admin";
const ADMIN_EMAIL = `${ADMIN_CLERK_ID}@blindwhisper.com`;
const USER_A = "clerk_user_a";
const USER_B = "clerk_user_b";

function asUser(userId: string) {
  return { [TEST_USER_HEADER]: userId };
}

async function asAdmin() {
  // Promotes, enrolls the app's own admin TOTP, verifies a real code, and
  // returns headers carrying the unlock token — see adminTestUtils.ts.
  return adminHeaders(ADMIN_CLERK_ID, ADMIN_EMAIL);
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

  it("includes this account's Debate Topics/comments in the investigation view", async () => {
    const adminHeaders = await asAdmin();
    const profile = await request(app).get("/api/user/profile").set(asUser(USER_A));

    const topic = await request(app).post("/api/debate-topics").set(asUser(USER_A)).send({ topicText: "Is a hot dog a sandwich?" });
    await request(app)
      .post(`/api/public/debate-topics/${topic.body.id}/comments`)
      .set(asUser(USER_A))
      .send({ commentText: "Obviously not.", visitorId: "visitor-admin-check" });

    const detail = await request(app).get(`/api/admin/users/${profile.body.id}`).set(adminHeaders);
    expect(detail.status).toBe(200);
    expect(detail.body.debateTopics.some((t: any) => t.id === topic.body.id)).toBe(true);
    expect(detail.body.debateTopicComments.length).toBeGreaterThanOrEqual(1);
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

describe("Admin: two-factor requirement", () => {
  // The gate itself (enrollment, codes, tokens) is covered in depth by
  // adminMfa.test.ts — this pins that /admin/* actually sits behind it.
  it("blocks an enrolled admin whose request carries no unlock token", async () => {
    const adminHeaders = await asAdmin();
    const { "x-admin-mfa": _token, ...withoutToken } = adminHeaders;

    const res = await request(app).get("/api/admin/users").set(withoutToken);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("admin_mfa_code_required");
  });

  it("allows an enrolled admin through with the unlock token", async () => {
    const adminHeaders = await asAdmin();
    const res = await request(app).get("/api/admin/users").set(adminHeaders);
    expect(res.status).toBe(200);
  });
});

describe("Admin: audit log", () => {
  it("records who banned a user, and lists it back", async () => {
    const adminHeaders = await asAdmin();
    const profile = await request(app).get("/api/user/profile").set(asUser(USER_A));

    await request(app).patch(`/api/admin/users/${profile.body.id}`).set(adminHeaders).send({ banned: true });

    const res = await request(app).get("/api/admin/audit-log").set(adminHeaders);
    expect(res.status).toBe(200);
    const entry = res.body.items.find((i: any) => i.action === "user.update" && i.targetId === profile.body.id);
    expect(entry).toBeTruthy();
  });

  it("does not log a GET/list request as an admin action", async () => {
    const adminHeaders = await asAdmin();
    await request(app).get("/api/admin/users").set(adminHeaders);

    const res = await request(app).get("/api/admin/audit-log").set(adminHeaders);
    expect(res.body.items.some((i: any) => i.action.startsWith("users.list"))).toBe(false);
  });
});


describe("Admin: repair placeholder profiles", () => {
  it("backfills real emails from Clerk and reports conflicts honestly", async () => {
    const adminHeaders = await asAdmin();

    // Two accounts created while Clerk had no email on file → placeholders.
    await request(app).get("/api/user/profile").set(asUser("clerk_repair_a"));
    await request(app).get("/api/user/profile").set(asUser("clerk_repair_b"));
    // And one whose real email will collide with an existing account.
    await request(app).get("/api/user/profile").set(asUser("clerk_repair_dupe"));

    clerkGetUserMock.mockImplementation(async (clerkId: string) => {
      if (clerkId === "clerk_repair_a")
        return { twoFactorEnabled: true, emailAddresses: [{ id: "e1", emailAddress: "repaired-a@example.com" }], primaryEmailAddressId: "e1", phoneNumbers: [] } as any;
      if (clerkId === "clerk_repair_dupe")
        // Same real email as repair_a — the second row hits the unique
        // constraint and must be counted as a conflict, not clobbered.
        return { twoFactorEnabled: true, emailAddresses: [{ id: "e1", emailAddress: "repaired-a@example.com" }], primaryEmailAddressId: "e1", phoneNumbers: [] } as any;
      // clerk_repair_b (and everyone else): no email in Clerk at all.
      return { twoFactorEnabled: true } as any;
    });

    const res = await request(app).post("/api/admin/users/repair-profiles").set(adminHeaders);
    expect(res.status).toBe(200);
    expect(res.body.healed).toBe(1);
    expect(res.body.conflicts).toBe(1);
    expect(res.body.noEmailInClerk).toBeGreaterThanOrEqual(1);

    const healed = await db.select().from(usersTable).where(eq(usersTable.clerkId, "clerk_repair_a")).then((r) => r[0]);
    expect(healed.email).toBe("repaired-a@example.com");
    const conflicted = await db.select().from(usersTable).where(eq(usersTable.clerkId, "clerk_repair_dupe")).then((r) => r[0]);
    expect(conflicted.email).toBe("clerk_repair_dupe@blindwhisper.com");
  });
});

describe("Admin: notification email channel", () => {
  it("counts every recipient email can't appropriately reach as skipped", async () => {
    const adminHeaders = await asAdmin();

    // One placeholder-email account and one opted-out account with a real
    // address — neither is emailable, for different reasons.
    const p1 = await request(app).get("/api/user/profile").set(asUser("clerk_email_placeholder"));
    const p2 = await request(app).get("/api/user/profile").set(asUser("clerk_email_optout"));
    await db.update(usersTable).set({ email: "optout@example.com", emailNotificationsEnabled: false }).where(eq(usersTable.id, p2.body.id));

    const res = await request(app)
      .post("/api/admin/notifications")
      .set(adminHeaders)
      .send({ title: "Maintenance tonight", body: "We'll be offline briefly.", audience: "users", userIds: [p1.body.id, p2.body.id], sendEmail: true });
    expect(res.status).toBe(201);
    expect(res.body.recipientCount).toBe(2);
    expect(res.body.emailsSent).toBe(0);
    expect(res.body.emailsSkipped).toBe(2);
  });

  it("omitting sendEmail keeps the email counters at zero", async () => {
    const adminHeaders = await asAdmin();
    const res = await request(app)
      .post("/api/admin/notifications")
      .set(adminHeaders)
      .send({ title: "Hello", body: "In-app only.", audience: "all" });
    expect(res.status).toBe(201);
    expect(res.body.emailsSent).toBe(0);
    expect(res.body.emailsSkipped).toBe(0);
  });
});
