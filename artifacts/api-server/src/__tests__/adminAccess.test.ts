import { describe, it, expect, afterEach } from "vitest";
import request from "supertest";
import app from "../app";
import { TEST_USER_HEADER, clerkGetUserMock } from "./setup";
import { adminHeaders, collaboratorHeaders } from "./adminTestUtils";
import { randomUUID } from "crypto";

const OWNER_CLERK_ID = "clerk_access_owner";
const OWNER_EMAIL = `${OWNER_CLERK_ID}@blindwhisper.com`;

function asUser(userId: string) {
  return { [TEST_USER_HEADER]: userId };
}

async function asOwner() {
  return adminHeaders(OWNER_CLERK_ID, OWNER_EMAIL);
}

// Signs a fresh user in whose Clerk profile carries a real email — the
// grant matching runs on email, so the account needs a non-placeholder one.
async function signInWithEmail(clerkId: string, email: string) {
  clerkGetUserMock.mockImplementation(async (id: string) =>
    id === clerkId
      ? ({ twoFactorEnabled: true, emailAddresses: [{ id: "e1", emailAddress: email }], primaryEmailAddressId: "e1", phoneNumbers: [] } as any)
      : ({ twoFactorEnabled: true } as any),
  );
  const res = await request(app).get("/api/user/profile").set(asUser(clerkId));
  return res.body;
}

afterEach(() => {
  delete process.env.ADMIN_EMAILS;
});

describe("Admin access control", () => {
  it("owner sees full access via /access/me; grants area is owner-only", async () => {
    const owner = await asOwner();
    const me = await request(app).get("/api/admin/access/me").set(owner);
    expect(me.status).toBe(200);
    expect(me.body.isOwner).toBe(true);
    expect(me.body.permissions).toContain("users");
    expect(me.body.permissions).toContain("projects");

    const grants = await request(app).get("/api/admin/access/grants").set(owner);
    expect(grants.status).toBe(200);
    expect(grants.body.availablePermissions.length).toBeGreaterThan(5);
    expect(grants.body.rolePresets.some((p: any) => p.title === "Moderator")).toBe(true);
  });

  it("inviting an existing user promotes them with exactly the granted areas", async () => {
    const owner = await asOwner();
    const collabEmail = `collab_${randomUUID()}@example.com`;
    const collabClerkId = `clerk_collab_${randomUUID()}`;
    await signInWithEmail(collabClerkId, collabEmail);

    const created = await request(app)
      .post("/api/admin/access/grants")
      .set(owner)
      .send({ email: collabEmail, roleTitle: "Moderator", permissions: ["moderation", "reports"] });
    expect(created.status).toBe(201);
    expect(created.body.linkedAt).not.toBeNull();

    // The collaborator is now role=admin → can enroll MFA and act, but
    // only inside their granted areas.
    const collab = await collaboratorHeaders(collabClerkId);

    const allowed = await request(app).get("/api/admin/moderation/flags").set(collab);
    expect(allowed.status).toBe(200);
    const reports = await request(app).get("/api/admin/content-reports").set(collab);
    expect(reports.status).toBe(200);

    const denied = await request(app).get("/api/admin/users").set(collab);
    expect(denied.status).toBe(403);
    expect(denied.body.code).toBe("admin_permission_required");
    const analytics = await request(app).get("/api/admin/usage-stats").set(collab);
    expect(analytics.status).toBe(403);

    // Not the owner: can't see or manage grants.
    const meRes = await request(app).get("/api/admin/access/me").set(collab);
    expect(meRes.body.isOwner).toBe(false);
    expect(meRes.body.permissions).toEqual(["moderation", "reports"]);
    const grantsList = await request(app).get("/api/admin/access/grants").set(collab);
    expect(grantsList.status).toBe(403);
    expect(grantsList.body.code).toBe("admin_owner_required");
  });

  it("an invite created before signup attaches on first sign-in", async () => {
    const owner = await asOwner();
    const futureEmail = `future_${randomUUID()}@example.com`;
    const created = await request(app)
      .post("/api/admin/access/grants")
      .set(owner)
      .send({ email: futureEmail, roleTitle: "Contributor", permissions: ["suggestions"] });
    expect(created.status).toBe(201);
    expect(created.body.linkedAt).toBeNull();

    const clerkId = `clerk_future_${randomUUID()}`;
    const profile = await signInWithEmail(clerkId, futureEmail);
    expect(profile.role).toBe("admin");

    const list = await request(app).get("/api/admin/access/grants").set(await asOwner());
    const row = list.body.items.find((g: any) => g.email === futureEmail);
    expect(row.linkedAt).not.toBeNull();
    expect(row.userId).toBe(profile.id);
  });

  it("editing a grant rescopes live; revoking demotes the account", async () => {
    const owner = await asOwner();
    const email = `rescope_${randomUUID()}@example.com`;
    const clerkId = `clerk_rescope_${randomUUID()}`;
    await signInWithEmail(clerkId, email);
    const created = await request(app)
      .post("/api/admin/access/grants")
      .set(owner)
      .send({ email, roleTitle: "Assistant", permissions: ["notifications"] });

    const collab = await collaboratorHeaders(clerkId);
    expect((await request(app).get("/api/admin/moderation/flags").set(collab)).status).toBe(403);

    await request(app)
      .patch(`/api/admin/access/grants/${created.body.id}`)
      .set(owner)
      .send({ permissions: ["notifications", "moderation"] });
    // Permissions are read live — same unlock token now passes moderation.
    expect((await request(app).get("/api/admin/moderation/flags").set(collab)).status).toBe(200);

    const revoke = await request(app).delete(`/api/admin/access/grants/${created.body.id}`).set(owner);
    expect(revoke.status).toBe(204);
    // Role gone entirely — the next admin request fails at the role gate.
    const after = await request(app).get("/api/admin/notifications").set(collab);
    expect(after.status).toBe(403);
    const profile = await request(app).get("/api/user/profile").set(asUser(clerkId));
    expect(profile.body.role).toBe("user");
  });

  it("refuses duplicate grants and granting the owner's own email", async () => {
    const owner = await asOwner();
    const email = `dupe_${randomUUID()}@example.com`;
    await request(app).post("/api/admin/access/grants").set(owner).send({ email, roleTitle: "Moderator", permissions: ["moderation"] });
    const dupe = await request(app).post("/api/admin/access/grants").set(owner).send({ email, roleTitle: "Moderator", permissions: ["moderation"] });
    expect(dupe.status).toBe(409);

    const self = await request(app)
      .post("/api/admin/access/grants")
      .set(owner)
      .send({ email: OWNER_EMAIL, roleTitle: "Admin", permissions: ["users"] });
    expect(self.status).toBe(400);
  });
});
