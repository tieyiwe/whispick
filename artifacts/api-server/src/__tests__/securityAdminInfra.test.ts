import { describe, it, expect, afterEach, vi } from "vitest";
import request from "supertest";
import { randomUUID } from "crypto";
import { eq, and } from "drizzle-orm";
import app from "../app";
import { db, usersTable, adminGrantsTable, adminAuditLogTable, notificationsTable, bugIssuesTable } from "@workspace/db";
import { TEST_USER_HEADER, clerkGetUserMock } from "./setup";
import { adminHeaders } from "./adminTestUtils";
import { totpCodeAt, issueMfaToken, verifyMfaToken } from "../lib/adminMfa";
import { scrubUrl, scrubPii, maskEmail, maskPhone } from "../lib/piiScrub";
import { isHttpUrlOrAppPath, normalizeHttpUrlOrAppPath } from "../lib/safeUrl";
import { adminAnnouncementEmailHtml } from "../lib/email";
import { listStaff } from "../lib/staff";

// Pre-launch security hardening of the admin/auth/infra layer — one file so
// the regressions for each finding live together.

function asUser(clerkId: string) {
  return { [TEST_USER_HEADER]: clerkId };
}

function clerkProfileWith(emails: { address: string; status: string | null }[], primaryIndex = 0) {
  return {
    twoFactorEnabled: true,
    emailAddresses: emails.map((e, i) => ({
      id: `e${i}`,
      emailAddress: e.address,
      verification: e.status ? { status: e.status } : null,
    })),
    primaryEmailAddressId: `e${primaryIndex}`,
    phoneNumbers: [],
    firstName: null,
    lastName: null,
  } as any;
}

async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 75));
}

afterEach(() => {
  delete process.env.ADMIN_EMAILS;
});

describe("ensureUser only trusts VERIFIED Clerk emails", () => {
  it("never takes an unverified address — even one matching ADMIN_EMAILS", async () => {
    const clerkId = `clerk_unverified_${randomUUID()}`;
    process.env.ADMIN_EMAILS = "owner-unverified@example.com";
    clerkGetUserMock.mockResolvedValue(clerkProfileWith([{ address: "owner-unverified@example.com", status: "unverified" }]));
    const res = await request(app).get("/api/user/profile").set(asUser(clerkId));
    expect(res.status).toBe(200);
    expect(res.body.email).toBe(`${clerkId}@blindwhisper.com`);
    expect(res.body.role).toBe("user");
  });

  it("treats a null verification as unverified", async () => {
    const clerkId = `clerk_nullverif_${randomUUID()}`;
    clerkGetUserMock.mockResolvedValue(clerkProfileWith([{ address: "nullverif@example.com", status: null }]));
    const res = await request(app).get("/api/user/profile").set(asUser(clerkId));
    expect(res.body.email).toBe(`${clerkId}@blindwhisper.com`);
  });

  it("skips an unverified primary in favor of a verified secondary", async () => {
    const clerkId = `clerk_secondary_${randomUUID()}`;
    clerkGetUserMock.mockResolvedValue(
      clerkProfileWith([
        { address: "primary-unverified@example.com", status: "unverified" },
        { address: "secondary-verified@example.com", status: "verified" },
      ]),
    );
    const res = await request(app).get("/api/user/profile").set(asUser(clerkId));
    expect(res.body.email).toBe("secondary-verified@example.com");
  });

  it("never re-points a grant that another account already claimed", async () => {
    const email = `claimed_${randomUUID()}@example.com`;
    await db.insert(adminGrantsTable).values({
      id: randomUUID(),
      email,
      userId: "some-other-user-id",
      roleTitle: "Moderator",
      permissions: JSON.stringify(["moderation"]),
      invitedByAdminId: "owner",
      linkedAt: new Date(),
    });
    clerkGetUserMock.mockResolvedValue(clerkProfileWith([{ address: email, status: "verified" }]));
    const res = await request(app).get("/api/user/profile").set(asUser(`clerk_claimed_${randomUUID()}`));
    expect(res.body.role).toBe("user");
  });

  it("strips owner status once Clerk reports the stored owner email is no longer verified", async () => {
    const clerkId = `clerk_owner_recheck_${randomUUID()}`;
    process.env.ADMIN_EMAILS = "owner-recheck@example.com";
    clerkGetUserMock.mockResolvedValue(clerkProfileWith([{ address: "owner-recheck@example.com", status: "verified" }]));
    const first = await request(app).get("/api/user/profile").set(asUser(clerkId));
    expect(first.body.role).toBe("admin");

    // Fail-safe: a Clerk answer with no emailAddresses array changes nothing.
    // (Date.now is advanced past the per-instance re-check throttle.)
    const realNow = Date.now();
    const clock = vi.spyOn(Date, "now");
    try {
      clerkGetUserMock.mockResolvedValue({ twoFactorEnabled: true } as any);
      clock.mockReturnValue(realNow + 11 * 60 * 1000);
      const stillOwner = await request(app).get("/api/user/profile").set(asUser(clerkId));
      expect(stillOwner.body.role).toBe("admin");

      // A definite "not verified" answer demotes and drops the address.
      clerkGetUserMock.mockResolvedValue(clerkProfileWith([{ address: "owner-recheck@example.com", status: "unverified" }]));
      clock.mockReturnValue(realNow + 22 * 60 * 1000);
      const demoted = await request(app).get("/api/user/profile").set(asUser(clerkId));
      expect(demoted.body.role).toBe("user");
      expect(demoted.body.email).toBe(`${clerkId}@blindwhisper.com`);
    } finally {
      clock.mockRestore();
    }
  });
});

describe("demoting/deleting a staff account revokes its grant", () => {
  it("a demoted collaborator is not silently re-promoted by their grant", async () => {
    const ownerId = "clerk_sec_demote_owner";
    const owner = await adminHeaders(ownerId, `${ownerId}@blindwhisper.com`);

    const collabEmail = `demote_${randomUUID()}@example.com`;
    const collabClerkId = `clerk_demote_${randomUUID()}`;
    clerkGetUserMock.mockImplementation(async (id: string) =>
      id === collabClerkId ? clerkProfileWith([{ address: collabEmail, status: "verified" }]) : ({ twoFactorEnabled: true } as any),
    );
    const collab = (await request(app).get("/api/user/profile").set(asUser(collabClerkId))).body;
    const grant = await request(app)
      .post("/api/admin/access/grants")
      .set(owner)
      .send({ email: collabEmail, roleTitle: "Moderator", permissions: ["moderation"] });
    expect(grant.status).toBe(201);

    const demote = await request(app).patch(`/api/admin/users/${collab.id}`).set(owner).send({ role: "user" });
    expect(demote.status).toBe(200);

    const remaining = await db.select().from(adminGrantsTable).where(eq(adminGrantsTable.email, collabEmail));
    expect(remaining).toHaveLength(0);

    const after = await request(app).get("/api/user/profile").set(asUser(collabClerkId));
    expect(after.body.role).toBe("user");
  });

  it("labels a grant-less non-owner admin 'No grant', not 'Super Admin'", async () => {
    const clerkId = `clerk_nogrant_${randomUUID()}`;
    const profile = (await request(app).get("/api/user/profile").set(asUser(clerkId))).body;
    await db.update(usersTable).set({ role: "admin" }).where(eq(usersTable.id, profile.id));
    const staff = await listStaff();
    expect(staff.find((s) => s.id === profile.id)?.roleTitle).toBe("No grant");
  });
});

describe("new-signup alerts only reach the owner + 'users' staff", () => {
  it("skips a collaborator without the users permission", async () => {
    const withUsersEmail = `alerts_users_${randomUUID()}@example.com`;
    const withoutUsersEmail = `alerts_mod_${randomUUID()}@example.com`;
    for (const [email, permissions] of [
      [withUsersEmail, ["users"]],
      [withoutUsersEmail, ["moderation"]],
    ] as const) {
      await db.insert(adminGrantsTable).values({
        id: randomUUID(),
        email,
        roleTitle: "Staff",
        permissions: JSON.stringify(permissions),
        invitedByAdminId: "owner",
      });
    }
    const ids: Record<string, string> = {};
    for (const email of [withUsersEmail, withoutUsersEmail]) {
      clerkGetUserMock.mockResolvedValueOnce(clerkProfileWith([{ address: email, status: "verified" }]));
      const res = await request(app).get("/api/user/profile").set(asUser(`clerk_alerts_${randomUUID()}`));
      expect(res.body.role).toBe("admin");
      ids[email] = res.body.id;
    }
    await settle();

    await request(app).get("/api/user/profile").set(asUser(`clerk_alerts_newbie_${randomUUID()}`));
    await settle();

    const signupAlerts = async (userId: string) =>
      db
        .select()
        .from(notificationsTable)
        .where(and(eq(notificationsTable.targetUserId, userId), eq(notificationsTable.kind, "admin_new_signup")));
    expect((await signupAlerts(ids[withUsersEmail]!)).length).toBeGreaterThanOrEqual(1);
    expect(await signupAlerts(ids[withoutUsersEmail]!)).toHaveLength(0);
  });
});

describe("admin MFA hardening", () => {
  async function enrolledAdmin() {
    const clerkId = `clerk_sec_mfa_${randomUUID()}`;
    process.env.ADMIN_EMAILS = `${clerkId}@blindwhisper.com`;
    const profile = (await request(app).get("/api/user/profile").set(asUser(clerkId))).body;
    const setup = await request(app).post("/api/admin-mfa/setup").set(asUser(clerkId));
    expect(setup.status).toBe(200);
    const code = totpCodeAt(setup.body.secret, Date.now());
    const activate = await request(app).post("/api/admin-mfa/verify").set(asUser(clerkId)).send({ code });
    expect(activate.status).toBe(200);
    return { clerkId, userId: profile.id as string, secret: setup.body.secret as string, code, backupCodes: activate.body.backupCodes as string[] };
  }

  function wrongCode(secret: string): string {
    const now = Date.now();
    const valid = new Set([-60_000, -30_000, 0, 30_000, 60_000].map((d) => totpCodeAt(secret, now + d)));
    let candidate = 0;
    while (valid.has(String(candidate).padStart(6, "0"))) candidate++;
    return String(candidate).padStart(6, "0");
  }

  it("rejects a replayed TOTP code", async () => {
    const { clerkId, code } = await enrolledAdmin();
    const replay = await request(app).post("/api/admin-mfa/verify").set(asUser(clerkId)).send({ code });
    expect(replay.status).toBe(400);
  });

  it("locks after 5 consecutive failures (persisted), audits each failure, and refuses even a valid code while locked", async () => {
    const { clerkId, userId, secret } = await enrolledAdmin();
    const bad = wrongCode(secret);
    const statuses: number[] = [];
    for (let i = 0; i < 5; i++) {
      statuses.push((await request(app).post("/api/admin-mfa/verify").set(asUser(clerkId)).send({ code: bad })).status);
    }
    expect(statuses).toEqual([400, 400, 400, 400, 429]);

    const locked = await request(app)
      .post("/api/admin-mfa/verify")
      .set(asUser(clerkId))
      .send({ code: totpCodeAt(secret, Date.now() + 30_000) });
    expect(locked.status).toBe(429);
    expect(locked.body.code).toBe("admin_mfa_locked");
    expect(locked.body.retryAfterSeconds).toBeGreaterThan(0);

    await settle();
    const audit = await db.select().from(adminAuditLogTable).where(eq(adminAuditLogTable.adminUserId, userId));
    expect(audit.filter((a) => a.action === "admin_mfa.verify_failed")).toHaveLength(5);
    expect(audit.filter((a) => a.action === "admin_mfa.locked")).toHaveLength(1);
  });

  it("a backup code can't be spent twice by concurrent requests", async () => {
    const { clerkId, backupCodes } = await enrolledAdmin();
    const [a, b] = await Promise.all([
      request(app).post("/api/admin-mfa/verify").set(asUser(clerkId)).send({ code: backupCodes[0] }),
      request(app).post("/api/admin-mfa/verify").set(asUser(clerkId)).send({ code: backupCodes[0] }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 400]);
  });

  it("binds unlock tokens to the Clerk session when one is present", () => {
    const token = issueMfaToken("user-a", Date.now(), "sess_a");
    expect(verifyMfaToken(token, "user-a", Date.now(), "sess_a")).toBe(true);
    expect(verifyMfaToken(token, "user-a", Date.now(), "sess_b")).toBe(false);
    expect(verifyMfaToken(token, "user-a", Date.now(), null)).toBe(false);
  });
});

describe("token scrubbing", () => {
  it("replaces long-hex and UUID path segments with :token", () => {
    const hex = "0123456789abcdef0123456789abcdef";
    expect(scrubUrl(`/w/${hex}`, 300)).toBe("/w/:token");
    expect(scrubUrl(`https://blindwhisper.com/api/public/w/${hex}/reply?x=1`, 300)).toBe("https://blindwhisper.com/api/public/w/:token/reply");
    expect(scrubUrl(`/invite/${randomUUID()}`, 300)).toBe("/invite/:token");
    expect(scrubUrl("/w/abc123", 300)).toBe("/w/abc123");
    expect(scrubPii(`GET /tw/${hex} failed`)).toBe("GET /tw/:token failed");
  });

  it("masks recipient identifiers for logs", () => {
    expect(maskEmail("jane@example.com")).toBe("j***@example.com");
    expect(maskPhone("+1 (555) 123-4567")).toBe("***4567");
  });
});

describe("URL safety", () => {
  it("rejects backslash/protocol-relative tricks and normalizes what it accepts", () => {
    expect(isHttpUrlOrAppPath("/\\evil.com")).toBe(false);
    expect(isHttpUrlOrAppPath("//evil.com")).toBe(false);
    expect(isHttpUrlOrAppPath("/whisps/abc")).toBe(true);
    expect(isHttpUrlOrAppPath("javascript:alert(1)")).toBe(false);
    expect(normalizeHttpUrlOrAppPath('https://x.com/"><img')).toBe("https://x.com/%22%3E%3Cimg");
  });

  it("escapes and absolutizes email link attributes", () => {
    const html = adminAnnouncementEmailHtml("Hi", "Body", "/whisps/abc");
    expect(html).toMatch(/href="https?:\/\/[^"]+\/whisps\/abc"/);
    const injected = adminAnnouncementEmailHtml("Hi", "Body", 'https://x.com/"><img src=x>');
    expect(injected).not.toContain('"><img');
  });
});

describe("error handler", () => {
  it("answers malformed JSON with 400 and files no BugRabbit issue", async () => {
    const before = await db.select().from(bugIssuesTable);
    const res = await request(app).post("/api/public/bug-reports").set("Content-Type", "application/json").send('{"message": ');
    expect(res.status).toBe(400);
    await settle();
    const after = await db.select().from(bugIssuesTable);
    expect(after.length).toBe(before.length);
  });

  it("answers an oversized body with 413", async () => {
    const res = await request(app)
      .post("/api/public/bug-reports")
      .set("Content-Type", "application/json")
      .send(JSON.stringify({ message: "x".repeat(200 * 1024) }));
    expect(res.status).toBe(413);
  });

  it("sends standard security headers and no x-powered-by", async () => {
    const res = await request(app).get("/api/does-not-exist");
    expect(res.headers["x-powered-by"]).toBeUndefined();
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["cross-origin-resource-policy"]).toBe("cross-origin");
  });
});
