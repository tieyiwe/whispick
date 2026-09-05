import { db } from "@workspace/db";
import { whispRepliesTable, whispsTable, usersTable } from "@workspace/db";
import { eq, and, lte, isNull, isNotNull } from "drizzle-orm";
import { sendEmail, replyNotificationEmailHtml } from "./email";
import { notifyUserPersisted } from "./push";
import { logger } from "./logger";
import { reportSystemError } from "./bugRabbit";

const POLL_INTERVAL_MS = 60_000;
// Same bounded-sweep reasoning as lib/scheduler.ts's BATCH_LIMIT — this loop
// awaits a real email send per row sequentially, so an unbounded due-count
// shouldn't be allowed to make one sweep run indefinitely. Leftover rows are
// picked up on the next poll, still only 60s away.
const BATCH_LIMIT = 100;

// Pulled out of startReplyNotificationScheduler so the due-row selection
// logic (the part that matters for correctness — matching the codebase's
// other schedulers, none of which are otherwise unit-tested since they're
// setInterval loops with no seams to fast-forward) can be exercised directly
// in a test without waiting on a real interval or system clock.
/**
 * Whisps whose recipient tried to whisp a video back and couldn't, past their
 * deferred notify time. Same deferral as a reply notification and for the same
 * reason — the trigger is a recipient action, so an immediate push would tie
 * the sender's buzzing phone to the recipient standing next to them.
 */
export async function getDueVideoReplyRequests() {
  return db
    .select()
    .from(whispsTable)
    .where(
      and(
        isNotNull(whispsTable.videoReplyRequestNotifyAt),
        lte(whispsTable.videoReplyRequestNotifyAt, new Date()),
        isNull(whispsTable.videoReplyRequestNotifiedAt),
      ),
    )
    .limit(BATCH_LIMIT);
}

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
    )
    .limit(BATCH_LIMIT);
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
        // Claim first (conditional on still-unnotified) so a sweep that
        // outruns the poll interval can't re-select this row and email the
        // sender twice — zero rows updated means another sweep owns it.
        const claimed = await db
          .update(whispRepliesTable)
          .set({ senderNotifiedAt: new Date() })
          .where(and(eq(whispRepliesTable.id, reply.id), isNull(whispRepliesTable.senderNotifiedAt)))
          .returning({ id: whispRepliesTable.id });
        if (claimed.length === 0) continue;

        const whisp = await db.select().from(whispsTable).where(eq(whispsTable.id, reply.whispId)).then((r) => r[0]);

        // Whisp gone (soft-deleted or otherwise unresolvable) — nothing to
        // notify about; the claim above already stamped it handled.
        if (!whisp) continue;

        const sender = await db.select().from(usersTable).where(eq(usersTable.id, whisp.senderId)).then((r) => r[0]);
        if (sender?.email) {
          void sendEmail(sender.email, "Someone replied to your whisp", replyNotificationEmailHtml(whisp.videoTitle), {
            whispId: whisp.id,
            purpose: "reply_notification",
          });
        }
        // Persisted, not push-only: a reply is the single most important
        // thing a sender comes back for, and a push they never received (no
        // permission granted, offline at the time) would otherwise leave no
        // trace in the app at all.
        await notifyUserPersisted(
          whisp.senderId,
          "You got a reply 💬",
          reply.videoUrl ? "Someone whisped a video back to you." : "Someone replied anonymously to your whisp.",
          `/whisps/${whisp.id}`,
          "reply",
        );
      }

      logger.info({ count: due.length }, "Dispatched deferred reply notifications");
    } catch (err) {
      logger.error({ err }, "Deferred reply notification dispatch failed");
      reportSystemError(err, "scheduler:replyNotificationScheduler:reply");
    }

    // Separate try block: a failure dispatching these must not stop reply
    // notifications, which matter more, and vice versa.
    try {
      const blocked = await getDueVideoReplyRequests();
      for (const whisp of blocked) {
        // Same claim-first pattern as above — one notification, ever.
        const claimed = await db
          .update(whispsTable)
          .set({ videoReplyRequestNotifiedAt: new Date() })
          .where(and(eq(whispsTable.id, whisp.id), isNull(whispsTable.videoReplyRequestNotifiedAt)))
          .returning({ id: whispsTable.id });
        if (claimed.length === 0) continue;
        await notifyUserPersisted(
          whisp.senderId,
          "They wanted to whisp a video back 🎬",
          "Your recipient tried to send a video back but isn't a member yet. Add reply credit to unlock it for them.",
          `/whisps/${whisp.id}`,
          "video_reply_request",
        );
      }
      if (blocked.length) {
        logger.info({ count: blocked.length }, "Dispatched deferred video-reply-request notifications");
      }
    } catch (err) {
      logger.error({ err }, "Deferred video-reply-request dispatch failed");
      reportSystemError(err, "scheduler:replyNotificationScheduler:videoReplyRequest");
    }
  }, POLL_INTERVAL_MS);
}
