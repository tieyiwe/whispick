import { db } from "@workspace/db";
import { textWhispsTable, type TextWhisp } from "@workspace/db";
import { eq, and, lte, isNull } from "drizzle-orm";
import { deliverInApp } from "./deliver";
import { sendSms, textWhispGuestSmsBody } from "./sms";
import { textWhispHookLine } from "./copy";
import { logger } from "./logger";
import { reportSystemError } from "./bugRabbit";

const POLL_INTERVAL_MS = 60_000;
// Same bounded-sweep reasoning as lib/scheduler.ts's BATCH_LIMIT — this loop
// awaits a real in-app/SMS send per row sequentially, so an unbounded due
// backlog shouldn't be allowed to make one sweep run indefinitely. Leftover
// rows are simply picked up on the next poll, still only 60s away.
const BATCH_LIMIT = 100;

// Pulled out from the setInterval loop below so the part that actually
// matters for correctness — which rows count as "due" — can be verified
// directly instead of waiting on real time or the interval firing. Same
// reasoning as lib/replyNotificationScheduler.ts's getDueReplyNotifications.
export async function getDueTextWhisps(): Promise<TextWhisp[]> {
  return db
    .select()
    .from(textWhispsTable)
    .where(
      and(
        eq(textWhispsTable.status, "scheduled"),
        lte(textWhispsTable.scheduledAt, new Date()),
        // A scheduled Text Whisp the sender since soft-deleted should never
        // actually go out — whisps.ts's own scheduler doesn't check this
        // (deletedBySenderAt is set without touching status), which is a
        // real gap in that older implementation. Not fixing whisps.ts here
        // (out of scope for this feature), but not repeating the gap either.
        isNull(textWhispsTable.deletedBySenderAt),
      ),
    )
    .limit(BATCH_LIMIT);
}

// Delivers Text Whisps whose scheduledAt has come due — the Text Whisp
// counterpart to lib/scheduler.ts's startScheduledWhispDispatcher, same
// "created now, delivered later" split (see routes/textWhisps.ts POST /).
// There's no incoming HTTP request here to derive a safe app URL from, so
// (like lib/scheduler.ts) this requires PUBLIC_APP_URL to be set explicitly
// — due rows are simply left in 'scheduled' state (retried next poll) until
// it's configured, rather than being marked sent without actually notifying
// anyone.
export function startScheduledTextWhispDispatcher(): void {
  setInterval(async () => {
    try {
      const due = await getDueTextWhisps();
      if (due.length === 0) return;

      const appUrl = process.env.PUBLIC_APP_URL;
      if (!appUrl) {
        logger.warn(
          { count: due.length },
          "PUBLIC_APP_URL is not set; scheduled Text Whisps are due but will stay queued until it's configured",
        );
        return;
      }

      for (const textWhisp of due) {
        const logCtx = { whispId: null, purpose: "text_whisp" as const };
        if (textWhisp.recipientUserId) {
          await deliverInApp(
            textWhisp.recipientUserId,
            "You have a new Text Whisp",
            textWhispHookLine(),
            `/text-whisps/${textWhisp.id}`,
            textWhisp.recipientPhone,
            logCtx,
          );
        } else {
          await sendSms(textWhisp.recipientPhone, textWhispGuestSmsBody(`${appUrl}/tw/${textWhisp.publicToken}`), logCtx);
        }
        // Best-effort, same as the immediate-send path (routes/textWhisps.ts
        // never checks deliverInApp/sendSms's own success flag either) —
        // status reflects "delivery was attempted," not transport success.
        await db.update(textWhispsTable).set({ status: "sent" }).where(eq(textWhispsTable.id, textWhisp.id));
      }

      logger.info({ count: due.length }, "Dispatched scheduled Text Whisps");
    } catch (err) {
      logger.error({ err }, "Scheduled Text Whisp dispatch failed");
      reportSystemError(err, "scheduler:textWhispScheduler");
    }
  }, POLL_INTERVAL_MS);
}
