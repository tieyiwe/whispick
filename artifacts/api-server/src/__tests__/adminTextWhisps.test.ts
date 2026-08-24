import { describe, it, expect } from "vitest";
import request from "supertest";
import app from "../app";
import { TEST_USER_HEADER, clerkGetUserMock } from "./setup";
import { adminHeaders, collaboratorHeaders } from "./adminTestUtils";
import { db, usersTable, textWhispsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import { ensureSystemAgentUser } from "../lib/systemUser";

const OWNER_CLERK_ID = "clerk_admin_tw_owner";
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

// Same pattern as adminAccess.test.ts's signInWithEmail — the grant-linking
// path matches on a real (non-placeholder) email.
async function signInWithEmail(clerkId: string, email: string) {
  clerkGetUserMock.mockImplementation(async (id: string) =>
    id === clerkId
      ? ({ twoFactorEnabled: true, emailAddresses: [{ id: "e1", emailAddress: email }], primaryEmailAddressId: "e1", phoneNumbers: [] } as any)
      : ({ twoFactorEnabled: true } as any),
  );
  const res = await request(app).get("/api/user/profile").set(asUser(clerkId));
  return res.body;
}

async function textWhispsTo(userId: string) {
  return db.select().from(textWhispsTable).where(eq(textWhispsTable.recipientUserId, userId));
}

describe("POST /api/admin/text-whisps/broadcast", () => {
  it("audience=selected sends only to the named targets, from the system account, with source/senderAlias/recipientUserId set", async () => {
    const owner = await asOwner();
    const targetA = await signIn(`clerk_tw_bcast_a_${randomUUID()}`);
    const targetB = await signIn(`clerk_tw_bcast_b_${randomUUID()}`);
    const system = await ensureSystemAgentUser();

    const res = await request(app)
      .post("/api/admin/text-whisps/broadcast")
      .set(owner)
      .send({ messageText: "Heads up: new feature just landed.", audience: "selected", userIds: [targetA.id, targetB.id] });

    expect(res.status).toBe(201);
    expect(res.body.recipientCount).toBe(2);

    for (const target of [targetA, targetB]) {
      const rows = await textWhispsTo(target.id);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.source).toBe("admin");
      expect(rows[0]!.senderAlias).toBe("Blind Whisper Team");
      expect(rows[0]!.senderId).toBe(system.id);
      expect(rows[0]!.recipientUserId).toBe(target.id);
      // No phone on file for either target — falls back to the internal sentinel.
      expect(rows[0]!.recipientPhone).toBe(`internal:${target.id}`);
    }
  });

  it("never targets the reserved system account, even if it's in the selected list", async () => {
    const owner = await asOwner();
    const system = await ensureSystemAgentUser();
    const target = await signIn(`clerk_tw_bcast_system_${randomUUID()}`);

    const res = await request(app)
      .post("/api/admin/text-whisps/broadcast")
      .set(owner)
      .send({ messageText: "Should skip the system account.", audience: "selected", userIds: [system.id, target.id] });

    expect(res.status).toBe(201);
    // recipientCount reflects Text Whisps actually created, not the raw
    // pre-filter selection — reporting the system account as "reached" would
    // mislead the admin into thinking 2 people got the message when only 1
    // real Text Whisp was ever written.
    expect(res.body.recipientCount).toBe(1);
    const systemRows = await textWhispsTo(system.id);
    expect(systemRows).toHaveLength(0);
    const targetRows = await textWhispsTo(target.id);
    expect(targetRows).toHaveLength(1);
  });

  it("audience=all reaches every user (system account excluded) without needing userIds", async () => {
    const owner = await asOwner();
    // ensureSystemAgentUser is also called inside the route before it lists
    // targets, so create it up front here to get a stable count.
    await ensureSystemAgentUser();
    const targetA = await signIn(`clerk_tw_bcast_all_a_${randomUUID()}`);
    const targetB = await signIn(`clerk_tw_bcast_all_b_${randomUUID()}`);

    const totalUsers = await db.select().from(usersTable);

    const res = await request(app)
      .post("/api/admin/text-whisps/broadcast")
      .set(owner)
      .send({ messageText: "Broadcast to everyone.", audience: "all" });

    expect(res.status).toBe(201);
    // Same accurate-count guarantee as above: every real user gets one Text
    // Whisp, the reserved system account gets none, and recipientCount
    // reflects exactly that — total users minus the one that's excluded.
    expect(res.body.recipientCount).toBe(totalUsers.length - 1);
    expect((await textWhispsTo(targetA.id))).toHaveLength(1);
    expect((await textWhispsTo(targetB.id))).toHaveLength(1);
    const system = await ensureSystemAgentUser();
    expect((await textWhispsTo(system.id))).toHaveLength(0);
  });

  it("400s when audience=selected but userIds is missing", async () => {
    const owner = await asOwner();
    const res = await request(app).post("/api/admin/text-whisps/broadcast").set(owner).send({ messageText: "Hi", audience: "selected" });
    expect(res.status).toBe(400);
  });

  it("400s when audience=selected but userIds is empty", async () => {
    const owner = await asOwner();
    const res = await request(app)
      .post("/api/admin/text-whisps/broadcast")
      .set(owner)
      .send({ messageText: "Hi", audience: "selected", userIds: [] });
    expect(res.status).toBe(400);
  });

  it("validates messageText length against the 260-char max", async () => {
    const owner = await asOwner();
    const target = await signIn(`clerk_tw_len_${randomUUID()}`);

    const tooLong = await request(app)
      .post("/api/admin/text-whisps/broadcast")
      .set(owner)
      .send({ messageText: "x".repeat(261), audience: "selected", userIds: [target.id] });
    expect(tooLong.status).toBe(400);

    const atLimit = await request(app)
      .post("/api/admin/text-whisps/broadcast")
      .set(owner)
      .send({ messageText: "x".repeat(260), audience: "selected", userIds: [target.id] });
    expect(atLimit.status).toBe(201);
  });

  it("requires admin auth", async () => {
    const res = await request(app).post("/api/admin/text-whisps/broadcast").send({ messageText: "Hi", audience: "all" });
    expect(res.status).toBe(401);
  });

  // Regression test: adminProjects.ts is mounted at the bare "/admin" base
  // (routes/index.ts) ahead of adminTextWhisps.ts's own "/admin/text-whisps"
  // prefix. If adminProjects.ts's requireAdmin/requirePermission("projects")
  // middleware were ever left unscoped (not prefixed to "/projects/"tasks"),
  // every /admin/* request that falls through this far without a matching
  // route — including /admin/text-whisps/* — would incorrectly demand the
  // "projects" permission before ever reaching adminTextWhisps.ts's own
  // (correct) "notifications" check. A collaborator granted "notifications"
  // but deliberately NOT "projects" must still be able to broadcast.
  it("a collaborator holding only 'notifications' (no 'projects') can still broadcast", async () => {
    const owner = await asOwner();
    const collabEmail = `tw_bcast_notif_only_${randomUUID()}@example.com`;
    const collabClerkId = `clerk_tw_bcast_notif_only_${randomUUID()}`;
    await signInWithEmail(collabClerkId, collabEmail);

    const grant = await request(app)
      .post("/api/admin/access/grants")
      .set(owner)
      .send({ email: collabEmail, roleTitle: "Notifications-only", permissions: ["notifications"] });
    expect(grant.status).toBe(201);

    const collabProfile = await signInWithEmail(collabClerkId, collabEmail);
    expect(collabProfile.role).toBe("admin");
    const collab = await collaboratorHeaders(collabClerkId);

    const target = await signIn(`clerk_tw_bcast_notif_target_${randomUUID()}`);
    const res = await request(app)
      .post("/api/admin/text-whisps/broadcast")
      .set(collab)
      .send({ messageText: "Notifications-only collaborator broadcast.", audience: "selected", userIds: [target.id] });

    expect(res.status).toBe(201);
    expect(res.body.recipientCount).toBe(1);

    // Meanwhile the projects area — correctly — stays off-limits.
    const projectsRes = await request(app).get("/api/admin/projects").set(collab);
    expect(projectsRes.status).toBe(403);
    expect(projectsRes.body.code).toBe("admin_permission_required");
    expect(projectsRes.body.permission).toBe("projects");
  });
});

describe("POST /api/admin/text-whisps/to-staff", () => {
  it("succeeds when the recipient is a real staff member (a linked collaborator grant)", async () => {
    const owner = await asOwner();
    const collabEmail = `tw_staff_${randomUUID()}@example.com`;
    const collabClerkId = `clerk_tw_staff_${randomUUID()}`;
    await signInWithEmail(collabClerkId, collabEmail);

    const grant = await request(app)
      .post("/api/admin/access/grants")
      .set(owner)
      .send({ email: collabEmail, roleTitle: "Assistant", permissions: ["notifications"] });
    expect(grant.status).toBe(201);

    // A second sign-in picks up the grant (ensureUser's existing-user path
    // promotes + links it — see lib/ensureUser.ts's maybeApplyAdminGrant),
    // which is what makes them show up in lib/staff.ts's listStaff().
    const collabProfile = await signInWithEmail(collabClerkId, collabEmail);
    expect(collabProfile.role).toBe("admin");

    const res = await request(app)
      .post("/api/admin/text-whisps/to-staff")
      .set(owner)
      .send({ recipientAdminId: collabProfile.id, messageText: "Welcome to the team." });

    expect(res.status).toBe(201);
    const rows = await textWhispsTo(collabProfile.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.source).toBe("admin");
    // Sent from the ACTING admin, not the system account — and their alias
    // falls back to email since this admin has no fullName set.
    expect(rows[0]!.senderId).not.toBe((await ensureSystemAgentUser()).id);
    const ownerRow = await db.select().from(usersTable).where(eq(usersTable.clerkId, OWNER_CLERK_ID)).then((r) => r[0]!);
    expect(rows[0]!.senderId).toBe(ownerRow.id);
    expect(rows[0]!.senderAlias).toBe(ownerRow.fullName || ownerRow.email);
  });

  it("400s when the target isn't a current staff member", async () => {
    const owner = await asOwner();
    const notStaff = await signIn(`clerk_tw_notstaff_${randomUUID()}`);

    const res = await request(app)
      .post("/api/admin/text-whisps/to-staff")
      .set(owner)
      .send({ recipientAdminId: notStaff.id, messageText: "Hi there." });
    expect(res.status).toBe(400);
    expect((await textWhispsTo(notStaff.id))).toHaveLength(0);
  });

  it("400s when a random/nonexistent id is targeted", async () => {
    const owner = await asOwner();
    const res = await request(app)
      .post("/api/admin/text-whisps/to-staff")
      .set(owner)
      .send({ recipientAdminId: randomUUID(), messageText: "Hi there." });
    expect(res.status).toBe(400);
  });

  it("400s when targeting yourself", async () => {
    const owner = await asOwner();
    const ownerRow = await db.select().from(usersTable).where(eq(usersTable.clerkId, OWNER_CLERK_ID)).then((r) => r[0]!);

    const res = await request(app)
      .post("/api/admin/text-whisps/to-staff")
      .set(owner)
      .send({ recipientAdminId: ownerRow.id, messageText: "Talking to myself." });
    expect(res.status).toBe(400);
  });

  it("requires admin auth", async () => {
    const res = await request(app).post("/api/admin/text-whisps/to-staff").send({ recipientAdminId: "x", messageText: "Hi" });
    expect(res.status).toBe(401);
  });
});
