import request from "supertest";
import app from "../app";
import { TEST_USER_HEADER } from "./setup";
import { totpCodeAt } from "../lib/adminMfa";

// requireAdmin now demands the app's own authenticator second factor
// (lib/adminMfa.ts), so "act as an admin" in tests means the real thing:
// promote via ADMIN_EMAILS, enroll TOTP, verify a genuinely-computed code,
// and carry the unlock token on every request. Shared here so each admin
// test file's asAdmin() stays one line instead of six files re-implementing
// the enrollment dance.
//
// The secret cache handles a second asAdmin() call inside one test: setup
// returns 409 once enrollment is enabled, so the cached secret from the
// first call is used to just re-verify. The afterEach truncate wipes
// admin_mfa rows, so across tests setup succeeds fresh and refreshes the
// cache — stale entries can't leak between tests.
const secretCache = new Map<string, string>();
// Verify now rejects a replayed TOTP code (same 30s step twice), so a second
// asAdmin() inside one test reuses the token from the first verify instead
// of re-submitting the identical code. Refreshed whenever setup succeeds.
const tokenCache = new Map<string, string>();

export async function adminHeaders(clerkId: string, adminEmail: string): Promise<Record<string, string>> {
  process.env.ADMIN_EMAILS = adminEmail;
  const base = { [TEST_USER_HEADER]: clerkId };
  // Any authenticated request runs ensureUser, which promotes on match.
  await request(app).get("/api/user/profile").set(base);

  const setup = await request(app).post("/api/admin-mfa/setup").set(base);
  let secret: string;
  if (setup.status === 200) {
    secret = setup.body.secret;
    secretCache.set(clerkId, secret);
    tokenCache.delete(clerkId);
  } else {
    const cachedToken = tokenCache.get(clerkId);
    if (cachedToken) return { ...base, "x-admin-mfa": cachedToken };
    const cached = secretCache.get(clerkId);
    if (!cached) throw new Error(`admin-mfa setup returned ${setup.status} with no cached secret for ${clerkId}`);
    secret = cached;
  }

  const verify = await request(app)
    .post("/api/admin-mfa/verify")
    .set(base)
    .send({ code: totpCodeAt(secret, Date.now()) });
  if (verify.status !== 200) {
    throw new Error(`admin-mfa verify failed in test helper: ${verify.status} ${JSON.stringify(verify.body)}`);
  }

  tokenCache.set(clerkId, verify.body.token);
  return { ...base, "x-admin-mfa": verify.body.token };
}

// A collaborator (admin via an access grant, NOT the ADMIN_EMAILS owner):
// same TOTP enrollment dance, but never touches ADMIN_EMAILS — being the
// owner would defeat the point of permission tests. The caller must have
// arranged the grant + a sign-in (so the role is already admin) first.
export async function collaboratorHeaders(clerkId: string): Promise<Record<string, string>> {
  const base = { [TEST_USER_HEADER]: clerkId };
  const setup = await request(app).post("/api/admin-mfa/setup").set(base);
  let secret: string;
  if (setup.status === 200) {
    secret = setup.body.secret;
    secretCache.set(clerkId, secret);
    tokenCache.delete(clerkId);
  } else {
    const cachedToken = tokenCache.get(clerkId);
    if (cachedToken) return { ...base, "x-admin-mfa": cachedToken };
    const cached = secretCache.get(clerkId);
    if (!cached) throw new Error(`collaborator admin-mfa setup returned ${setup.status} with no cached secret for ${clerkId}`);
    secret = cached;
  }
  const verify = await request(app)
    .post("/api/admin-mfa/verify")
    .set(base)
    .send({ code: totpCodeAt(secret, Date.now()) });
  if (verify.status !== 200) {
    throw new Error(`collaborator admin-mfa verify failed: ${verify.status} ${JSON.stringify(verify.body)}`);
  }
  tokenCache.set(clerkId, verify.body.token);
  return { ...base, "x-admin-mfa": verify.body.token };
}
