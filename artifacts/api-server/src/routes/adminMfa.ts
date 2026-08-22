import { Router, type IRouter } from "express";
import { db, adminMfaTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { getAuth } from "@clerk/express";
import { z } from "zod";
import { requireAuth } from "../lib/auth";
import { ensureUser } from "../lib/ensureUser";
import {
  generateTotpSecret,
  totpProvisioningUri,
  verifyTotpCode,
  generateBackupCodes,
  consumeBackupCode,
  issueMfaToken,
  getAdminMfa,
} from "../lib/adminMfa";
import { logAdminAction } from "../lib/adminAudit";
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

  res.json({
    secret,
    otpauthUrl: totpProvisioningUri(secret, user.email),
  });
});

const verifySchema = z.object({ code: z.string().min(1).max(32) });

// POST /api/admin-mfa/verify — confirm a 6-digit authenticator code (or,
// once enrolled, a one-time backup code). On the FIRST successful
// verification the enrollment is activated and the backup codes are
// generated and returned — the only time they ever exist in plaintext.
// Every success returns a signed unlock token the frontend attaches to
// admin requests (see requireAdmin in lib/adminAuth.ts).
router.post("/verify", requireAuth, async (req, res): Promise<void> => {
  const user = await requireAdminRole(req, res);
  if (!user) return;

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

  if (!mfa.enabledAt) {
    // Enrollment confirmation — must be a real TOTP code (backup codes
    // don't exist yet).
    if (!verifyTotpCode(mfa.totpSecret, code)) {
      res.status(400).json({ error: "That code didn't match. Check your authenticator app and try again." });
      return;
    }
    const backup = generateBackupCodes();
    await db
      .update(adminMfaTable)
      .set({ enabledAt: new Date(), backupCodeHashes: JSON.stringify(backup.hashes) })
      .where(eq(adminMfaTable.userId, user.id));
    logAdminAction(user.id, "admin_mfa.enroll", { type: "user", id: user.id }, {});
    res.json({ token: issueMfaToken(user.id), backupCodes: backup.plaintext });
    return;
  }

  // Normal unlock: authenticator code first, backup code as the fallback.
  if (verifyTotpCode(mfa.totpSecret, code)) {
    res.json({ token: issueMfaToken(user.id) });
    return;
  }
  const remaining = consumeBackupCode(mfa.backupCodeHashes, code);
  if (remaining !== null) {
    await db.update(adminMfaTable).set({ backupCodeHashes: JSON.stringify(remaining) }).where(eq(adminMfaTable.userId, user.id));
    logger.info({ userId: user.id, remaining: remaining.length }, "Admin backup code consumed");
    res.json({ token: issueMfaToken(user.id), backupCodesRemaining: remaining.length });
    return;
  }

  res.status(400).json({ error: "That code didn't match. Check your authenticator app and try again." });
});

export default router;
