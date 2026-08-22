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
  } else {
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

  return { ...base, "x-admin-mfa": verify.body.token };
}
