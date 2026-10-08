import { Router, type IRouter } from "express";
import { db, adminMfaTable } from "@workspace/db";
import { and, eq, gte, isNull, lt, or, sql } from "drizzle-orm";
import { getAuth } from "@clerk/express";
import { z } from "zod";
import { requireAuth } from "../lib/auth";
import { adminMfaVerifyLimiter } from "../lib/rateLimit";
import { ensureUser } from "../lib/ensureUser";
import {
  generateTotpSecret,
  totpProvisioningUri,
  matchTotpStep,
  generateBackupCodes,
  consumeBackupCode,
  issueMfaToken,
  getAdminMfa,
} from "../lib/adminMfa";
import { logAdminAction } from "../lib/adminAudit";
import { notifyOfAdminMfaLockout } from "../lib/adminNotify";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// Admin MFA enrollment + unlock — the app's own authenticator-app second
// factor (see lib/adminMfa.ts for why Clerk's can't be used). These
// endpoints sit OUTSIDE requireAdmin on purpose: they're the door the MFA
// gate sends a locked-out admin through, so gating them behind that same
// gate would be a deadlock. They still require a signed-in ADMIN-role
// account — checked inline below — so a regular user can't even see
// whether MFA is enrolled.
async function requireAdminRole(req: any, res: any): Promise<{ id: string; email: string } | null> {
  const { userId } = getAuth(req);
  const user = await ensureUser(userId!, req);
  if (user.banned || user.role !== "admin") {
    res.status(403).json({ error: "Admin access required" });
    return null;
  }
  return user;
}

// GET /api/admin-mfa/status — whether this admin has finished enrollment.
router.get("/status", requireAuth, async (req, res): Promise<void> => {
  const user = await requireAdminRole(req, res);
  if (!user) return;
  const mfa = await getAdminMfa(user.id);
  res.json({ enrolled: !!mfa?.enabledAt });
});

// POST /api/admin-mfa/setup — start (or restart a pending) enrollment:
// issues the TOTP secret + otpauth URI for the authenticator app. An
// ALREADY-ENABLED enrollment is never overwritten here — regenerating the
// secret out from under a working authenticator would silently lock the
// admin out. Re-running setup while still pending is fine and issues a
// fresh secret (the QR was probably lost/expired off-screen).
router.post("/setup", requireAuth, async (req, res): Promise<void> => {
  const user = await requireAdminRole(req, res);
  if (!user) return;

  const existing = await getAdminMfa(user.id);
  if (existing?.enabledAt) {
    res.status(409).json({ error: "Two-factor authentication is already set up for this account." });
    return;
  }

  const secret = generateTotpSecret();
  if (existing) {
    await db.update(adminMfaTable).set({ totpSecret: secret }).where(eq(adminMfaTable.userId, user.id));
  } else {
    await db.insert(adminMfaTable).values({ userId: user.id, totpSecret: secret, enabledAt: null, backupCodeHashes: "[]" });
  }
  logAdminAction(user.id, existing ? "admin_mfa.setup_reissue" : "admin_mfa.setup", { type: "user", id: user.id }, {});

  res.json({
    secret,
    otpauthUrl: totpProvisioningUri(secret, user.email),
  });
});

const verifySchema = z.object({ code: z.string().min(1).max(32) });

// Brute-force lockout, persisted on the admin_mfa row so it holds across
// autoscaled instances and scale-to-zero restarts (adminMfaVerifyLimiter is
// only a per-instance backstop). 5 consecutive misses → 15 min lockout,
// doubling with each further lockout (capped at 24h) until a success.
const MAX_FAILED_ATTEMPTS = 5;
const BASE_LOCKOUT_MS = 15 * 60 * 1000;
const MAX_LOCKOUT_MS = 24 * 60 * 60 * 1000;

function lockedResponse(res: any, lockedUntil: Date): void {
  const retryAfterSeconds = Math.max(1, Math.ceil((lockedUntil.getTime() - Date.now()) / 1000));
  res.setHeader("Retry-After", String(retryAfterSeconds));
  res.status(429).json({
    error: `Too many incorrect codes. Try again in ${Math.ceil(retryAfterSeconds / 60)} minute(s).`,
    code: "admin_mfa_locked",
    retryAfterSeconds,
  });
}

// Records one failed verify (atomic increment) and, on the threshold, the
// lockout. Returns the lockout end when THIS failure triggered one. The
// lock UPDATE is conditional on the counter still being at threshold, so
// concurrent failures can't double-apply it.
async function recordFailure(user: { id: string; email: string }, enrolled: boolean): Promise<Date | null> {
  const after = await db
    .update(adminMfaTable)
    .set({ failedAttempts: sql`${adminMfaTable.failedAttempts} + 1` })
    .where(eq(adminMfaTable.userId, user.id))
    .returning({ failedAttempts: adminMfaTable.failedAttempts, lockoutCount: adminMfaTable.lockoutCount })
    .then((r) => r[0]);
  logAdminAction(user.id, "admin_mfa.verify_failed", { type: "user", id: user.id }, { enrolled, consecutiveFailures: after?.failedAttempts ?? null });
  if (!after || after.failedAttempts < MAX_FAILED_ATTEMPTS) return null;

  const lockoutMs = Math.min(BASE_LOCKOUT_MS * 2 ** Math.min(after.lockoutCount, 10), MAX_LOCKOUT_MS);
  const lockedUntil = new Date(Date.now() + lockoutMs);
  const locked = await db
    .update(adminMfaTable)
    .set({ lockedUntil, failedAttempts: 0, lockoutCount: sql`${adminMfaTable.lockoutCount} + 1` })
    .where(and(eq(adminMfaTable.userId, user.id), gte(adminMfaTable.failedAttempts, MAX_FAILED_ATTEMPTS)))
    .returning({ lockoutCount: adminMfaTable.lockoutCount })
    .then((r) => r[0]);
  if (!locked) return null;
  logger.warn({ userId: user.id, lockedUntil, lockoutCount: locked.lockoutCount }, "Admin MFA locked after repeated failed codes");
  logAdminAction(user.id, "admin_mfa.locked", { type: "user", id: user.id }, { lockedUntil: lockedUntil.toISOString(), lockoutCount: locked.lockoutCount });
  void notifyOfAdminMfaLockout(user, lockedUntil);
  return lockedUntil;
}

// Accepts a TOTP code only if its time-step is newer than the last one
// accepted — a conditional UPDATE, so a code (even one observed over a
// shoulder, or raced from two tabs) can be used exactly once. Also clears
// the failure/lockout counters.
async function claimTotpStep(userId: string, step: number, extra: Partial<typeof adminMfaTable.$inferInsert> = {}): Promise<boolean> {
  const claimed = await db
    .update(adminMfaTable)
    .set({ ...extra, lastUsedStep: step, failedAttempts: 0, lockoutCount: 0, lockedUntil: null })
    .where(and(eq(adminMfaTable.userId, userId), or(isNull(adminMfaTable.lastUsedStep), lt(adminMfaTable.lastUsedStep, step))))
    .returning({ userId: adminMfaTable.userId })
    .then((r) => r[0]);
  return !!claimed;
}

// Consumes a backup code with a compare-and-swap on the stored hash list, so
// two concurrent requests can't both spend the same code. Retries a couple
// of times only if a DIFFERENT code changed the list underneath us.
async function claimBackupCode(userId: string, code: string): Promise<number | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const current = await getAdminMfa(userId);
    if (!current) return null;
    const remaining = consumeBackupCode(current.backupCodeHashes, code);
    if (remaining === null) return null;
    const swapped = await db
      .update(adminMfaTable)
      .set({ backupCodeHashes: JSON.stringify(remaining), failedAttempts: 0, lockoutCount: 0, lockedUntil: null })
      .where(and(eq(adminMfaTable.userId, userId), eq(adminMfaTable.backupCodeHashes, current.backupCodeHashes)))
      .returning({ userId: adminMfaTable.userId })
      .then((r) => r[0]);
    if (swapped) return remaining.length;
  }
  return null;
}

// POST /api/admin-mfa/verify — confirm a 6-digit authenticator code (or,
// once enrolled, a one-time backup code). On the FIRST successful
// verification the enrollment is activated and the backup codes are
// generated and returned — the only time they ever exist in plaintext.
// Every success returns a signed unlock token the frontend attaches to
// admin requests (see requireAdmin in lib/adminAuth.ts).
router.post("/verify", requireAuth, adminMfaVerifyLimiter, async (req, res): Promise<void> => {
  const user = await requireAdminRole(req, res);
  if (!user) return;
  const sessionId = getAuth(req).sessionId ?? null;

  const parsed = verifySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Enter the code from your authenticator app." });
    return;
  }
  const code = parsed.data.code.trim();

  const mfa = await getAdminMfa(user.id);
  if (!mfa) {
    res.status(400).json({ error: "Two-factor authentication hasn't been set up yet.", code: "admin_mfa_setup_required" });
    return;
  }

  if (mfa.lockedUntil && mfa.lockedUntil.getTime() > Date.now()) {
    lockedResponse(res, mfa.lockedUntil);
    return;
  }

  const fail = async (): Promise<void> => {
    const lockedUntil = await recordFailure(user, !!mfa.enabledAt);
    if (lockedUntil) {
      lockedResponse(res, lockedUntil);
      return;
    }
    res.status(400).json({ error: "That code didn't match. Check your authenticator app and try again." });
  };

  const step = matchTotpStep(mfa.totpSecret, code);

  if (!mfa.enabledAt) {
    // Enrollment confirmation — must be a real TOTP code (backup codes
    // don't exist yet).
    if (step === null) {
      await fail();
      return;
    }
    const backup = generateBackupCodes();
    if (!(await claimTotpStep(user.id, step, { enabledAt: new Date(), backupCodeHashes: JSON.stringify(backup.hashes) }))) {
      await fail();
      return;
    }
    logAdminAction(user.id, "admin_mfa.enroll", { type: "user", id: user.id }, {});
    res.json({ token: issueMfaToken(user.id, Date.now(), sessionId), backupCodes: backup.plaintext });
    return;
  }

  // Normal unlock: authenticator code first, backup code as the fallback.
  // Logged (distinct from admin_mfa.enroll above) so "who accessed the
  // admin panel and when" is part of the reviewable footprint, not just
  // what they did once inside.
  if (step !== null) {
    if (await claimTotpStep(user.id, step)) {
      logAdminAction(user.id, "admin_mfa.unlock", { type: "user", id: user.id }, { method: "totp" });
      res.json({ token: issueMfaToken(user.id, Date.now(), sessionId) });
      return;
    }
    // A valid but already-used code (replay) is a failure like any other.
    logger.warn({ userId: user.id }, "Admin MFA: replayed TOTP code rejected");
    await fail();
    return;
  }
  const remaining = await claimBackupCode(user.id, code);
  if (remaining !== null) {
    logger.info({ userId: user.id, remaining }, "Admin backup code consumed");
    logAdminAction(user.id, "admin_mfa.unlock", { type: "user", id: user.id }, { method: "backup_code", backupCodesRemaining: remaining });
    res.json({ token: issueMfaToken(user.id, Date.now(), sessionId), backupCodesRemaining: remaining });
    return;
  }

  await fail();
});

export default router;
