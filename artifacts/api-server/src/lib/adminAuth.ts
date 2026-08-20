import { getAuth, clerkClient } from "@clerk/express";
import { ensureUser } from "./ensureUser";
import { logger } from "./logger";

// Deliberately untyped, same reasoning as lib/auth.ts's requireAuth.
export async function requireAdmin(req: any, res: any, next: any) {
  const { userId } = getAuth(req);
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const user = await ensureUser(userId, req);
  if (user.banned) {
    res.status(403).json({ error: "Your account has been suspended" });
    return;
  }
  if (user.role !== "admin") {
    res.status(403).json({ error: "Admin access required" });
    return;
  }

  // An admin account is a far higher-value target than an ordinary one — it
  // can ban/delete users, take down content, and (as of the content-posting
  // agents) publish to public feeds. Two-factor is optional for everyone
  // else, but mandatory here: checked live against Clerk (the single source
  // of truth for whether it's actually enabled, never cached/duplicated in
  // our own DB — see users.mfaNudgeDismissedAt's comment) on every admin
  // request, not just at login, so revoking it mid-session still locks the
  // panel out immediately.
  try {
    const clerkUser = await clerkClient.users.getUser(userId);
    if (!clerkUser.twoFactorEnabled) {
      res.status(403).json({
        error: "Two-factor authentication is required for admin accounts. Set it up in Account Settings, then try again.",
        code: "admin_mfa_required",
      });
      return;
    }
  } catch (err) {
    logger.error({ err, userId }, "Failed to verify admin 2FA status with Clerk");
    res.status(503).json({ error: "Couldn't verify account security status. Please try again." });
    return;
  }

  req.adminUser = user;
  next();
}
