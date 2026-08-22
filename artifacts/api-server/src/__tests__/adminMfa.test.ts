import { describe, it, expect, afterEach } from "vitest";
import request from "supertest";
import app from "../app";
import { TEST_USER_HEADER } from "./setup";
import { totpCodeAt, verifyMfaToken, issueMfaToken } from "../lib/adminMfa";

const ADMIN_CLERK_ID = "clerk_mfa_admin";
const ADMIN_EMAIL = `${ADMIN_CLERK_ID}@blindwhisper.com`;

function asUser(userId: string) {
  return { [TEST_USER_HEADER]: userId };
}

async function promoteAdmin() {
  process.env.ADMIN_EMAILS = ADMIN_EMAIL;
  await request(app).get("/api/user/profile").set(asUser(ADMIN_CLERK_ID));
  return asUser(ADMIN_CLERK_ID);
}

afterEach(() => {
  delete process.env.ADMIN_EMAILS;
});

describe("Admin MFA enrollment + gate", () => {
  it("rejects non-admins from every admin-mfa endpoint", async () => {
    const res = await request(app).get("/api/admin-mfa/status").set(asUser("clerk_mfa_regular_user"));
    expect(res.status).toBe(403);
    const setup = await request(app).post("/api/admin-mfa/setup").set(asUser("clerk_mfa_regular_user"));
    expect(setup.status).toBe(403);
  });

  it("locks /admin/* behind setup, then behind a code, then unlocks with the token", async () => {
    const headers = await promoteAdmin();

    // No enrollment yet → setup_required.
    const locked = await request(app).get("/api/admin/users").set(headers);
    expect(locked.status).toBe(403);
    expect(locked.body.code).toBe("admin_mfa_setup_required");

    // Enroll: setup issues a secret, first verified code activates and
    // returns backup codes + an unlock token.
    const setup = await request(app).post("/api/admin-mfa/setup").set(headers);
    expect(setup.status).toBe(200);
    expect(setup.body.otpauthUrl).toContain("otpauth://totp/");

    const status = await request(app).get("/api/admin-mfa/status").set(headers);
    expect(status.body.enrolled).toBe(false);

    const activate = await request(app)
      .post("/api/admin-mfa/verify")
      .set(headers)
      .send({ code: totpCodeAt(setup.body.secret, Date.now()) });
    expect(activate.status).toBe(200);
    expect(activate.body.token).toBeTruthy();
    expect(activate.body.backupCodes).toHaveLength(8);

    // Enrolled but no token on the request → code_required.
    const stillLocked = await request(app).get("/api/admin/users").set(headers);
    expect(stillLocked.status).toBe(403);
    expect(stillLocked.body.code).toBe("admin_mfa_code_required");

    // Token on the request → open.
    const open = await request(app).get("/api/admin/users").set({ ...headers, "x-admin-mfa": activate.body.token });
    expect(open.status).toBe(200);
  });

  it("rejects a wrong code and a garbage token", async () => {
    const headers = await promoteAdmin();
    const setup = await request(app).post("/api/admin-mfa/setup").set(headers);
    const bad = await request(app).post("/api/admin-mfa/verify").set(headers).send({ code: "000000" });
    // One-in-a-million false positive if 000000 happens to be the real
    // code — regenerate then; in practice this pins the rejection path.
    if (totpCodeAt(setup.body.secret, Date.now()) !== "000000") {
      expect(bad.status).toBe(400);
    }

    await request(app)
      .post("/api/admin-mfa/verify")
      .set(headers)
      .send({ code: totpCodeAt(setup.body.secret, Date.now()) });
    const forged = await request(app).get("/api/admin/users").set({ ...headers, "x-admin-mfa": "not.a.token" });
    expect(forged.status).toBe(403);
  });

  it("refuses to regenerate an active secret via setup (409)", async () => {
    const headers = await promoteAdmin();
    const setup = await request(app).post("/api/admin-mfa/setup").set(headers);
    await request(app)
      .post("/api/admin-mfa/verify")
      .set(headers)
      .send({ code: totpCodeAt(setup.body.secret, Date.now()) });

    const again = await request(app).post("/api/admin-mfa/setup").set(headers);
    expect(again.status).toBe(409);
  });

  it("accepts a backup code once and consumes it", async () => {
    const headers = await promoteAdmin();
    const setup = await request(app).post("/api/admin-mfa/setup").set(headers);
    const activate = await request(app)
      .post("/api/admin-mfa/verify")
      .set(headers)
      .send({ code: totpCodeAt(setup.body.secret, Date.now()) });
    const backupCode = activate.body.backupCodes[0];

    const first = await request(app).post("/api/admin-mfa/verify").set(headers).send({ code: backupCode });
    expect(first.status).toBe(200);
    expect(first.body.backupCodesRemaining).toBe(7);

    const reuse = await request(app).post("/api/admin-mfa/verify").set(headers).send({ code: backupCode });
    expect(reuse.status).toBe(400);
  });

  it("binds unlock tokens to the issuing user", async () => {
    const token = issueMfaToken("user-a");
    expect(verifyMfaToken(token, "user-a")).toBe(true);
    expect(verifyMfaToken(token, "user-b")).toBe(false);
    // Tampered signature fails.
    expect(verifyMfaToken(token.slice(0, -2) + "ff", "user-a")).toBe(false);
    // Expired fails.
    expect(verifyMfaToken(token, "user-a", Date.now() + 13 * 60 * 60 * 1000)).toBe(false);
  });
});
