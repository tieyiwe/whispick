import { db } from "@workspace/db";
import { whispsTable } from "@workspace/db";
import { eq, and, lte, isNotNull } from "drizzle-orm";
import { deliverWhisperLink } from "./deliver";
import { reminderHookLine } from "./copy";
import { isExpired, MAX_REMINDERS } from "./expiration";
import { logger } from "./logger";

const POLL_INTERVAL_MS = 60_000;

// Dispatches "remind me later" follow-ups the recipient scheduled from the
// public whisp page (see routes/public.ts's /remind-me). Same
// PUBLIC_APP_URL requirement and "leave it queued, don't silently drop it"
// posture as lib/scheduler.ts, for the same reason — this isn't a
// per-request path, so there's no Host header to derive a safe link from.
export function startReminderDispatcher(): void {
  setInterval(async () => {
    try {
      const due = await db
        .select()
        .from(whispsTable)
        .where(and(isNotNull(whispsTable.nextReminderAt), lte(whispsTable.nextReminderAt, new Date())));

      if (due.length === 0) return;

      const appUrl = process.env.PUBLIC_APP_URL;
      if (!appUrl) {
        logger.warn({ count: due.length }, "PUBLIC_APP_URL is not set; reminders are due but will stay queued until it's configured");
        return;
      }

      for (const whisp of due) {
        // Expired before the reminder fired, or already used up its
        // reminders some other way — just clear the schedule, don't send.
        if (isExpired(whisp.expiresAt) || whisp.reminderCount >= MAX_REMINDERS || !whisp.expiresAt) {
          await db.update(whispsTable).set({ nextReminderAt: null }).where(eq(whispsTable.id, whisp.id));
          continue;
        }

        const newCount = whisp.reminderCount + 1;
        const isFinal = newCount >= MAX_REMINDERS;
        deliverWhisperLink(whisp, appUrl, reminderHookLine(isFinal, whisp.expiresAt));

        await db
          .update(whispsTable)
          .set({ reminderCount: newCount, lastReminderAt: new Date(), nextReminderAt: null })
          .where(eq(whispsTable.id, whisp.id));
      }

      logger.info({ count: due.length }, "Dispatched whisp reminders");
    } catch (err) {
      logger.error({ err }, "Reminder dispatch failed");
    }
  }, POLL_INTERVAL_MS);
}
