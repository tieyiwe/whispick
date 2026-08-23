import { getAuth } from "@clerk/express";
import { db, adminGrantsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { ensureUser, isBootstrapAdminEmail } from "./ensureUser";
import { getAdminMfa, verifyMfaToken } from "./adminMfa";

// The HQ's feature areas — one key per admin surface, matching the route
// prefixes enforced in routes/admin.ts and the nav groups in AdminLayout.
// A collaborator's grant (admin_grants.ts) holds a subset; the owner holds
// all of them implicitly.
export const ALL_ADMIN_PERMISSIONS = [
  "users",
  "whisps",
  "moderation",
  "reports",
  "suggestions",
  "agents",
  "notifications",
  "policies",
  "analytics",
  "audit_log",
  "projects",
] as const;
export type AdminPermission = (typeof ALL_ADMIN_PERMISSIONS)[number];

// Named staff roles as permission presets — a starting point the owner can
// customize per person. Enforcement never reads these: they only fill the
// permissions array at invite time (and drive the invite form's UI), so
// tweaking a preset later never silently changes anyone's existing access.
export const ROLE_PRESETS: { title: string; permissions: AdminPermission[] }[] = [
  { title: "Admin", permissions: [...ALL_ADMIN_PERMISSIONS] },
  { title: "Content Manager", permissions: ["agents", "suggestions", "whisps", "projects"] },
  { title: "Moderator", permissions: ["moderation", "reports", "projects"] },
  { title: "Assistant", permissions: ["notifications", "policies", "analytics", "projects"] },
  { title: "Contributor", permissions: ["suggestions", "projects"] },
];

// The super admin: the ADMIN_EMAILS bootstrap owner. Holds every
// permission implicitly and is the only one who can manage collaborator
// grants — access control can't be used to lock the owner out or to
// self-escalate.
export function isOwner(user: { email: string }): boolean {
  return isBootstrapAdminEmail(user.email);
}

export async function permissionsFor(user: { id: string; email: string }): Promise<AdminPermission[]> {
  if (isOwner(user)) return [...ALL_ADMIN_PERMISSIONS];
  const grant = await db.select().from(adminGrantsTable).where(eq(adminGrantsTable.userId, user.id)).then((r) => r[0]);
  if (!grant) return [];
  try {
    const parsed = JSON.parse(grant.permissions);
    return (Array.isArray(parsed) ? parsed : []).filter((p): p is AdminPermission =>
      (ALL_ADMIN_PERMISSIONS as readonly string[]).includes(p),
    );
  } catch {
    return [];
  }
}

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

  // The HQ's own authenticator second factor (lib/adminMfa.ts) — checked on
  // every admin request. Two distinct failure codes drive the frontend
  // gate's two screens: not enrolled yet vs. enrolled but this session
  // hasn't entered a code (or its unlock token expired).
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
  req.adminPermissions = await permissionsFor(user);
  req.adminIsOwner = isOwner(user);
  next();
}

// Per-feature-area gate, mounted on route prefixes AFTER requireAdmin (see
// routes/admin.ts). The owner always passes; a collaborator passes only
// when their grant carries the key.
export function requirePermission(permission: AdminPermission) {
  return (req: any, res: any, next: any) => {
    if (req.adminIsOwner || (req.adminPermissions ?? []).includes(permission)) {
      next();
      return;
    }
    res.status(403).json({
      error: "You don't have access to this area — ask the owner to update your permissions.",
      code: "admin_permission_required",
      permission,
    });
  };
}

// Owner-only actions (managing collaborator grants).
export function requireOwner(req: any, res: any, next: any) {
  if (req.adminIsOwner) {
    next();
    return;
  }
  res.status(403).json({ error: "Only the owner can manage staff access.", code: "admin_owner_required" });
}
