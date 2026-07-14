import webpush from "web-push";
import { db } from "@workspace/db";
import { pushSubscriptionsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger";

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const VAPID_SUBJECT = process.env.VAPID_SUBJECT ?? "mailto:support@whispick.app";

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
export async function notifyUser(userId: string, title: string, body: string, url: string): Promise<void> {
  if (!isConfigured) {
    logger.warn({ userId }, "VAPID keys not set; skipping push notification");
    return;
  }

  const subscriptions = await db
    .select()
    .from(pushSubscriptionsTable)
    .where(eq(pushSubscriptionsTable.userId, userId));

  await Promise.all(
    subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          },
          JSON.stringify({ title, body, url }),
        );
      } catch (err: any) {
        // 404/410 mean the browser subscription is gone — clean it up so we
        // stop trying. Any other error is logged but left alone (transient).
        if (err?.statusCode === 404 || err?.statusCode === 410) {
          await db.delete(pushSubscriptionsTable).where(eq(pushSubscriptionsTable.id, sub.id));
        } else {
          logger.error({ userId, err }, "Failed to send push notification");
        }
      }
    }),
  );
}
