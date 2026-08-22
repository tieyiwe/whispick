import { getAuth } from "@clerk/express";
import { ensureUser } from "./ensureUser";
import { getAdminMfa, verifyMfaToken } from "./adminMfa";

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
  // else, but mandatory here, using Blind Whisper's OWN authenticator-app
  // enrollment (lib/adminMfa.ts / routes/adminMfa.ts) — not Clerk's
  // twoFactorEnabled, which this app's Replit-managed Clerk instance can
  // never turn on. Enrollment is checked live per request; the unlock
  // token a verified code earns is signed and self-expiring, so no
  // server-side session state exists to manage or leak.
  const mfa = await getAdminMfa(user.id);
  if (!mfa?.enabledAt) {
    res.status(403).json({
      error: "Two-factor authentication is required for admin accounts. Set it up to continue.",
      code: "admin_mfa_setup_required",
    });
    return;
  }

  const token = req.headers["x-admin-mfa"];
  if (typeof token !== "string" || !verifyMfaToken(token, user.id)) {
    res.status(403).json({
      error: "Enter your authenticator code to unlock the admin panel.",
      code: "admin_mfa_code_required",
    });
    return;
  }

  req.adminUser = user;
  next();
}
