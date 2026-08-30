import { db } from "@workspace/db";
import { usersTable } from "@workspace/db";
import { and, eq, ne } from "drizzle-orm";
import { notifyUserPersisted } from "./push";

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
// account is still an admin who might want to know. Fire-and-forget: a
// failure notifying one admin (or all of them) must never block the
// signup/post that triggered it.

async function notifyableAdminIds(toggleColumn: typeof usersTable.notifyOnNewSignup | typeof usersTable.notifyOnNewDebateTopic, excludeUserId?: string): Promise<string[]> {
  const rows = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(
      excludeUserId
        ? and(eq(usersTable.role, "admin"), eq(toggleColumn, true), ne(usersTable.id, excludeUserId))
        : and(eq(usersTable.role, "admin"), eq(toggleColumn, true)),
    );
  return rows.map((r) => r.id);
}

export async function notifyAdminsOfNewSignup(newUser: { id: string; fullName: string | null; email: string }): Promise<void> {
  try {
    const adminIds = await notifyableAdminIds(usersTable.notifyOnNewSignup, newUser.id);
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
    const adminIds = await notifyableAdminIds(usersTable.notifyOnNewDebateTopic, topic.authorId);
    const title = "New Debate Now post 🗣️";
    const body = `${topic.authorHandle} just posted a new debate topic.`;
    const url = `/debate-topics/${topic.id}`;
    await Promise.all(adminIds.map((adminId) => notifyUserPersisted(adminId, title, body, url, "admin_new_debate_topic")));
  } catch {
    // Best-effort only — never let an admin-alert failure affect the post
    // that triggered it.
  }
}
