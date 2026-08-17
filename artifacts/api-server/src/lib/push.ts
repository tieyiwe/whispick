import webpush from "web-push";
import { db } from "@workspace/db";
import { pushSubscriptionsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger";

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const VAPID_SUBJECT = process.env.VAPID_SUBJECT ?? "mailto:support@blindwhisper.com";

const isConfigured = !!VAPID_PUBLIC_KEY && !!VAPID_PRIVATE_KEY;

if (isConfigured) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY!, VAPID_PRIVATE_KEY!);
}

export function getVapidPublicKey(): string | null {
  return VAPID_PUBLIC_KEY ?? null;
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
