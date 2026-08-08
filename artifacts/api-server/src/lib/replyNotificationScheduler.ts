import { db } from "@workspace/db";
import { whispRepliesTable, whispsTable, usersTable } from "@workspace/db";
import { eq, and, lte, isNull, isNotNull } from "drizzle-orm";
import { sendEmail, replyNotificationEmailHtml } from "./email";
import { notifyUser } from "./push";
import { logger } from "./logger";

const POLL_INTERVAL_MS = 60_000;

// Pulled out of startReplyNotificationScheduler so the due-row selection
// logic (the part that matters for correctness — matching the codebase's
// other schedulers, none of which are otherwise unit-tested since they're
// setInterval loops with no seams to fast-forward) can be exercised directly
// in a test without waiting on a real interval or system clock.
export async function getDueReplyNotifications() {
  return db
    .select()
    .from(whispRepliesTable)
    .where(
      and(
        isNotNull(whispRepliesTable.notifySenderAt),
        lte(whispRepliesTable.notifySenderAt, new Date()),
        isNull(whispRepliesTable.senderNotifiedAt),
      ),
    );
}

// Dispatches the Sender-facing "you got a reply" email + push that
// routes/public.ts's POST /w/:token/reply used to fire immediately. Delaying
// it by a random 3/5/9 minutes (set on the reply row as notifySenderAt)
// breaks the timing correlation a Sender and Recipient being physically
// together would otherwise create — see the schema comment on
// whisp_replies.notifySenderAt for the full rationale. Only rows with
// notifySenderAt set are ever due here — sender-authored follow-ups
// (fromRecipient: false) never set it and so never match this query.
//
// This handler doesn't originate from an HTTP request, so — same as
// lib/scheduler.ts and lib/reminderScheduler.ts — it needs PUBLIC_APP_URL to
// build a safe link and leaves due rows queued (not silently dropped) until
// it's configured.
export function startReplyNotificationScheduler(): void {
  setInterval(async () => {
    try {
      const due = await getDueReplyNotifications();

      if (due.length === 0) return;

      const appUrl = process.env.PUBLIC_APP_URL;
      if (!appUrl) {
        logger.warn(
          { count: due.length },
          "PUBLIC_APP_URL is not set; deferred reply notifications are due but will stay queued until it's configured",
        );
        return;
      }

      for (const reply of due) {
        const whisp = await db.select().from(whispsTable).where(eq(whispsTable.id, reply.whispId)).then((r) => r[0]);

        // Whisp gone (soft-deleted or otherwise unresolvable) — nothing to
        // notify about. Mark it handled so it doesn't stay queued forever.
        if (!whisp) {
          await db
            .update(whispRepliesTable)
            .set({ senderNotifiedAt: new Date() })
            .where(eq(whispRepliesTable.id, reply.id));
          continue;
        }

        const sender = await db.select().from(usersTable).where(eq(usersTable.id, whisp.senderId)).then((r) => r[0]);
        if (sender?.email) {
          void sendEmail(sender.email, "Someone replied to your whisp", replyNotificationEmailHtml(whisp.videoTitle), {
            whispId: whisp.id,
            purpose: "reply_notification",
          });
        }
        void notifyUser(
          whisp.senderId,
          "You got a reply 💬",
          reply.videoUrl ? "Someone whisped a video back to you." : "Someone replied anonymously to your whisp.",
          `${appUrl}/whisps/${whisp.id}`,
        );

        await db
          .update(whispRepliesTable)
          .set({ senderNotifiedAt: new Date() })
          .where(eq(whispRepliesTable.id, reply.id));
      }

      logger.info({ count: due.length }, "Dispatched deferred reply notifications");
    } catch (err) {
      logger.error({ err }, "Deferred reply notification dispatch failed");
    }
  }, POLL_INTERVAL_MS);
}
