import { db } from "@workspace/db";
import { usersTable, adminGrantsTable } from "@workspace/db";
import { and, eq, inArray, ne } from "drizzle-orm";
import { notifyUserPersisted } from "./push";
import { isBootstrapAdminEmail } from "./ensureUser";

// Admin-facing product-event alerts — distinct from routes/admin.ts's
// POST /admin/notifications (an admin COMPOSING a message TO regular
// users). These go the other direction: the app telling every admin that
// something happened. Reuses notifyUserPersisted (in-app row + best-effort
// push) rather than inventing a separate delivery path, so an admin sees
// these in the exact same bell every other notification lands in — "as
// well as admin" just means "admins are users too, and this is how users
// get notified."
//
// Fans out to every admin (role='admin', not just the bootstrap owner) who
// hasn't turned the specific alert off — a collaborator with their own
// account is still an admin who might want to know. The signup alert is
// narrower (owner + "users" permission only), since it names the new user. Fire-and-forget: a
// failure notifying one admin (or all of them) must never block the
// signup/post that triggered it.

async function notifyableAdmins(toggleColumn: typeof usersTable.notifyOnNewSignup | typeof usersTable.notifyOnNewDebateTopic, excludeUserId?: string): Promise<{ id: string; email: string }[]> {
  return db
    .select({ id: usersTable.id, email: usersTable.email })
    .from(usersTable)
    .where(
      excludeUserId
        ? and(eq(usersTable.role, "admin"), eq(toggleColumn, true), ne(usersTable.id, excludeUserId))
        : and(eq(usersTable.role, "admin"), eq(toggleColumn, true)),
    );
}

// A signup alert carries the new user's name/email — PII that only the
// owner and staff holding the "users" area may see, not every collaborator.
async function filterToUsersPermission(admins: { id: string; email: string }[]): Promise<string[]> {
  if (!admins.length) return [];
  const grants = await db
    .select({ userId: adminGrantsTable.userId, permissions: adminGrantsTable.permissions })
    .from(adminGrantsTable)
    .where(inArray(adminGrantsTable.userId, admins.map((a) => a.id)));
  const withUsers = new Set(
    grants
      .filter((g) => {
        try {
          const parsed = JSON.parse(g.permissions);
          return Array.isArray(parsed) && parsed.includes("users");
        } catch {
          return false;
        }
      })
      .map((g) => g.userId),
  );
  return admins.filter((a) => isBootstrapAdminEmail(a.email) || withUsers.has(a.id)).map((a) => a.id);
}

export async function notifyAdminsOfNewSignup(newUser: { id: string; fullName: string | null; email: string }): Promise<void> {
  try {
    const adminIds = await filterToUsersPermission(await notifyableAdmins(usersTable.notifyOnNewSignup, newUser.id));
    const title = "New user joined 🎉";
    const body = `${newUser.fullName || newUser.email} just signed up.`;
    await Promise.all(adminIds.map((adminId) => notifyUserPersisted(adminId, title, body, "/admin_pro/users", "admin_new_signup")));
  } catch {
    // Best-effort only — never let an admin-alert failure affect the
    // signup that triggered it.
  }
}

export async function notifyAdminsOfNewDebateTopic(topic: { id: string; authorId: string; authorHandle: string }): Promise<void> {
  try {
    const adminIds = (await notifyableAdmins(usersTable.notifyOnNewDebateTopic, topic.authorId)).map((a) => a.id);
    const title = "New Debate Now post 🗣️";
    const body = `${topic.authorHandle} just posted a new debate topic.`;
    const url = `/debate-topics/${topic.id}`;
    await Promise.all(adminIds.map((adminId) => notifyUserPersisted(adminId, title, body, url, "admin_new_debate_topic")));
  } catch {
    // Best-effort only — never let an admin-alert failure affect the post
    // that triggered it.
  }
}

// Security alert: an admin account's HQ authenticator hit the brute-force
// lockout (routes/adminMfa.ts). Goes to the ADMIN_EMAILS owner(s) and to the
// locked admin themselves — repeated wrong codes mean someone may be holding
// their Clerk session. Not gated on any notify* toggle: a security event.
export async function notifyOfAdminMfaLockout(lockedAdmin: { id: string; email: string }, lockedUntil: Date): Promise<void> {
  try {
    const admins = await db.select({ id: usersTable.id, email: usersTable.email }).from(usersTable).where(eq(usersTable.role, "admin"));
    const recipients = new Set(admins.filter((a) => isBootstrapAdminEmail(a.email)).map((a) => a.id));
    recipients.add(lockedAdmin.id);
    const title = "Admin sign-in locked 🔒";
    const body = `Too many wrong authenticator codes for ${lockedAdmin.email}. Admin unlock is blocked until ${lockedUntil.toISOString()}.`;
    await Promise.all([...recipients].map((id) => notifyUserPersisted(id, title, body, "/admin_pro", "admin_mfa_locked")));
  } catch {
    // Best-effort only.
  }
}
