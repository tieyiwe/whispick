import { db, usersTable, notificationsTable } from "@workspace/db";
import { and, eq, gte, isNull, ne } from "drizzle-orm";
import { sendEmail, replyEmailHtml } from "./email";
import { isPlaceholderEmail } from "./ensureUser";
import { logger } from "./logger";
import type { DeliveryPurpose } from "./deliveryLog";

// "Someone replied" emails — on by default, off with the one
// users.emailNotificationsEnabled switch in Settings (the same one that
// governs "you have a new whisp" emails). Always sent alongside an in-app
// notification, never instead of one.
//
// Throttled per conversation: a reply only emails if there was no earlier
// notification of the same kind for the same thread in the last
// REPLY_EMAIL_COOLDOWN_MS. A back-and-forth chat therefore sends one email
// for the burst, not one per message, and the next one goes out once the
// thread has been quiet for a while. Call this AFTER the reply's own
// notification row exists (it's excluded by id), so the check sees only
// what came before it.
export const REPLY_EMAIL_COOLDOWN_MS = 60 * 60 * 1000;

export type ReplyEmail = {
  subject: string;
  heading: string;
  text: string;
  /** In-app path the button opens, e.g. `/text-whisps/<id>`. */
  path: string;
  /** notifications.kind of the in-app notification this email accompanies. */
  kind: string;
  /** The just-created notification for this reply, if any (excluded from the throttle). */
  notificationId?: string | null;
  purpose: DeliveryPurpose;
  whispId?: string | null;
};

export async function emailReplyNotification(userId: string, email: ReplyEmail): Promise<boolean> {
  try {
    const user = await db
      .select({
        email: usersTable.email,
        clerkId: usersTable.clerkId,
        emailNotificationsEnabled: usersTable.emailNotificationsEnabled,
        banned: usersTable.banned,
      })
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .then((r) => r[0]);
    if (!user?.email || !user.emailNotificationsEnabled || user.banned || isPlaceholderEmail(user.email, user.clerkId)) {
      return false;
    }

    const since = new Date(Date.now() - REPLY_EMAIL_COOLDOWN_MS);
    const earlier = await db
      .select({ id: notificationsTable.id })
      .from(notificationsTable)
      .where(
        and(
          eq(notificationsTable.targetUserId, userId),
          eq(notificationsTable.kind, email.kind),
          eq(notificationsTable.url, email.path),
          // Still-pending deferred rows don't count — they haven't been
          // delivered (or emailed) yet.
          isNull(notificationsTable.deliverAfter),
          gte(notificationsTable.createdAt, since),
          ...(email.notificationId ? [ne(notificationsTable.id, email.notificationId)] : []),
        ),
      )
      .limit(email.notificationId ? 1 : 2);
    // Without an id to exclude, the reply's own row is one of the matches.
    if (earlier.length >= (email.notificationId ? 1 : 2)) return false;

    return await sendEmail(user.email, email.subject, replyEmailHtml(email.heading, email.text, email.path, "/settings"), {
      whispId: email.whispId ?? null,
      purpose: email.purpose,
    });
  } catch (err) {
    logger.error({ err, userId, kind: email.kind }, "Failed to send reply email");
    return false;
  }
}
