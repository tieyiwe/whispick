import webpush from "web-push";
import { db } from "@workspace/db";
import { pushSubscriptionsTable, notificationsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import { logger } from "./logger";

// Trimmed, not raw: a VAPID value pasted into a hosting secret store
// (Replit Secrets, etc.) very easily picks up a trailing space or newline,
// which web-push's base64url decode then rejects — so normalize before use.
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY?.trim() || undefined;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY?.trim() || undefined;
// setVapidDetails requires the subject to be a mailto: or https: URL and
// throws otherwise; a bare "support@blindwhisper.com" with no mailto: prefix
// is the most common way this is misconfigured, so repair that specific case
// rather than letting it take push down.
const rawSubject = process.env.VAPID_SUBJECT?.trim();
const VAPID_SUBJECT =
  rawSubject && (rawSubject.startsWith("mailto:") || rawSubject.startsWith("http"))
    ? rawSubject
    : rawSubject
      ? `mailto:${rawSubject}`
      : "mailto:support@blindwhisper.com";

// isConfigured stays false if setVapidDetails rejects the values — a
// malformed VAPID key/subject must NEVER be able to crash the whole server.
// This runs at module-load time (this file is imported during startup), so
// an uncaught throw here exits the process before it can open its port,
// which the platform reports as "failed to open a port in time" — a broken
// notification feature masquerading as a total outage. Catch it, log it,
// and degrade to exactly the same "push disabled" state as no keys at all.
let isConfigured = false;
if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  try {
    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
    isConfigured = true;
  } catch (err) {
    logger.error({ err }, "Invalid VAPID configuration; push notifications disabled. Check VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT for typos or stray whitespace.");
  }
}

export function getVapidPublicKey(): string | null {
  // Only hand the browser a key the server can actually sign pushes with —
  // if setVapidDetails rejected the config above, isConfigured is false and
  // this returns null (→ GET /push-public-key 503s), so the client doesn't
  // subscribe against a key that would then never deliver anything.
  return isConfigured ? VAPID_PUBLIC_KEY ?? null : null;
}

// Notifies every browser subscription the user has registered. Fires on
// first open, watched_complete, and a reply — the same real signals already
// shown on the dashboard, just delivered live instead of requiring the
// sender to go check. No-ops (with a log warning) if VAPID keys aren't
// configured, same pattern as email/SMS.
export async function notifyUser(userId: string, title: string, body: string, url: string): Promise<number> {
  if (!isConfigured) {
    logger.warn({ userId }, "VAPID keys not set; skipping push notification");
    return 0;
  }

  const subscriptions = await db
    .select()
    .from(pushSubscriptionsTable)
    .where(eq(pushSubscriptionsTable.userId, userId));

  const results = await Promise.all(subscriptions.map((sub) => pushToSubscription(sub, title, body, url, { userId })));
  return results.filter(Boolean).length;
}

// The two-layer notification every user-facing event should use: a
// PERSISTENT in-app notification (the bell — routes/user.ts's GET
// /notifications) plus a best-effort live browser push.
//
// notifyUser alone is push-ONLY, which means the notification effectively
// doesn't exist for anyone who hasn't granted browser-notification
// permission, has no VAPID keys configured, or simply wasn't online when it
// fired — there's nothing to come back and find later. Anything a user would
// reasonably expect to see in the app (a reply to their whisp, their whisp
// being opened/watched/appreciated) needs to be persisted too, which is what
// this does. Push failures never block persistence: the row is written
// first, and the push is fire-and-forget after it.
//
// Same shape as lib/deliver.ts's deliverInApp, minus the delivery-attempt
// logging that's specific to actually delivering a whisp to a recipient.
export async function notifyUserPersisted(
  userId: string,
  title: string,
  body: string,
  url: string,
  kind?: string,
): Promise<void> {
  try {
    await db.insert(notificationsTable).values({
      id: randomUUID(),
      targetUserId: userId,
      title,
      body,
      url: url || null,
      kind: kind ?? null,
      // Not admin-composed — see the notifications schema comment.
      createdByAdminId: null,
    });
  } catch (err) {
    // A failed persist shouldn't swallow the live push too — log and still
    // try to reach them in the moment.
    logger.error({ userId, err }, "Failed to persist in-app notification");
  }
  void notifyUser(userId, title, body, url);
}

// Shared by notifyUser (one person's browsers) and notifyAllUsers (an
// admin broadcast) — same "clean up dead subscriptions, log anything else"
// handling either way.
async function pushToSubscription(
  sub: { id: string; endpoint: string; p256dh: string; auth: string },
  title: string,
  body: string,
  url: string,
  logContext: Record<string, unknown>,
): Promise<boolean> {
  try {
    await webpush.sendNotification(
      {
        endpoint: sub.endpoint,
        keys: { p256dh: sub.p256dh, auth: sub.auth },
      },
      JSON.stringify({ title, body, url }),
    );
    return true;
  } catch (err: any) {
    // 404/410 mean the browser subscription is gone — clean it up so we
    // stop trying. Any other error is logged but left alone (transient).
    if (err?.statusCode === 404 || err?.statusCode === 410) {
      await db.delete(pushSubscriptionsTable).where(eq(pushSubscriptionsTable.id, sub.id));
    } else {
      logger.error({ ...logContext, err }, "Failed to send push notification");
    }
    return false;
  }
}

// Broadcasts an admin notification live to every browser with an active
// subscription, instead of looping every user and querying their
// subscriptions one at a time (an N+1 that could mean thousands of queries
// on a real user base) — one query for all subscriptions, then fan out.
// Recipients without a subscription still see the notification next time
// they open the app (it's persisted — see routes/admin.ts's POST
// /notifications and routes/user.ts's GET /notifications). Returns how many
// pushes actually went out.
export async function notifyAllUsers(title: string, body: string, url?: string): Promise<number> {
  if (!isConfigured) {
    logger.warn("VAPID keys not set; skipping broadcast push notification");
    return 0;
  }

  const subscriptions = await db.select().from(pushSubscriptionsTable);
  const results = await Promise.all(
    subscriptions.map((sub) => pushToSubscription(sub, title, body, url ?? "", { broadcast: true })),
  );
  return results.filter(Boolean).length;
}
