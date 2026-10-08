import { randomUUID } from "crypto";
import { db } from "@workspace/db";
import { whispRepliesTable, whispsTable, usersTable, notificationsTable } from "@workspace/db";
import { eq, and, lte, isNull, isNotNull } from "drizzle-orm";
import { sendEmail, replyNotificationEmailHtml, appreciationNotificationEmailHtml } from "./email";
import { notifyUser, notifyUserPersisted } from "./push";
import { logger } from "./logger";
import { reportSystemError } from "./bugRabbit";

const POLL_INTERVAL_MS = 60_000;
// Same bounded-sweep reasoning as lib/scheduler.ts's BATCH_LIMIT — this loop
// awaits a real email send per row sequentially, so an unbounded due-count
// shouldn't be allowed to make one sweep run indefinitely. Leftover rows are
// picked up on the next poll, still only 60s away.
const BATCH_LIMIT = 100;

// One of 3, 5, or 9 minutes out, chosen at random each time — a discrete
// choice (not a continuous range) per the anti-correlation design: enough
// spread that a Sender's phone buzzing can't be tied to a Recipient who just
// hit send while physically next to them. See notifySenderAt's schema
// comment. Shared by every deferred notification below.
const NOTIFY_DELAY_MINUTES_OPTIONS = [3, 5, 9] as const;
export function randomNotifyDelay(): Date {
  const minutes = NOTIFY_DELAY_MINUTES_OPTIONS[Math.floor(Math.random() * NOTIFY_DELAY_MINUTES_OPTIONS.length)];
  return new Date(Date.now() + minutes * 60_000);
}

/**
 * The deferred counterpart of notifyUserPersisted, for every notification an
 * anonymous party's action triggers (opened/watched/appreciated, a Circle
 * comment or comment reaction, a Whisper Box message, ...). An instant push
 * there is a side channel: whoever is sitting next to the target sees their
 * phone buzz the moment they act, and learns who the anonymous poster/sender
 * is. Same 3/5/9-minute randomized delay replies already get, and durable
 * (a DB row, not a setTimeout) because Autoscale instances scale to zero.
 *
 * Coalesced: while one is still pending for the same (user, kind, url), a
 * second is dropped — a burst of comments on one post (or someone rotating
 * visitorIds to spam it) lands as one buzz, not one per action. The check
 * and insert aren't atomic; a rare duplicate under a race is harmless.
 */
export async function scheduleDeferredNotification(userId: string, title: string, body: string, url: string, kind: string): Promise<void> {
  try {
    const pending = await db
      .select({ id: notificationsTable.id })
      .from(notificationsTable)
      .where(
        and(
          eq(notificationsTable.targetUserId, userId),
          eq(notificationsTable.kind, kind),
          eq(notificationsTable.url, url),
          isNotNull(notificationsTable.deliverAfter),
        ),
      )
      .limit(1);
    if (pending.length) return;
    await db.insert(notificationsTable).values({
      id: randomUUID(),
      targetUserId: userId,
      title,
      body,
      url: url || null,
      kind,
      createdByAdminId: null,
      deliverAfter: randomNotifyDelay(),
    });
  } catch (err) {
    logger.error({ userId, kind, err }, "Failed to schedule deferred notification");
  }
}

export async function getDueDeferredNotifications() {
  return db
    .select()
    .from(notificationsTable)
    .where(and(isNotNull(notificationsTable.deliverAfter), lte(notificationsTable.deliverAfter, new Date())))
    .limit(BATCH_LIMIT);
}

/**
 * Releases every due deferred notification: makes it visible (deliverAfter
 * back to null, createdAt reset to now so the bell's "x minutes ago" doesn't
 * reveal when the action really happened), then sends the live push — and,
 * for an appreciation, the email that used to go out immediately with it.
 * Exported so tests can drive one sweep without waiting on the interval.
 */
export async function dispatchDueDeferredNotifications(): Promise<number> {
  const due = await getDueDeferredNotifications();
  let dispatched = 0;
  for (const n of due) {
    // Claim-first, same as the reply sweep: zero rows means another sweep
    // (or another instance) already released it.
    const claimed = await db
      .update(notificationsTable)
      .set({ deliverAfter: null, createdAt: new Date() })
      .where(and(eq(notificationsTable.id, n.id), isNotNull(notificationsTable.deliverAfter)))
      .returning({ id: notificationsTable.id });
    if (claimed.length === 0 || !n.targetUserId) continue;
    dispatched++;

    if (n.kind === "appreciation") {
      const whispId = n.url?.match(/^\/whisps\/([^/?#]+)$/)?.[1];
      const whisp = whispId ? await db.select().from(whispsTable).where(eq(whispsTable.id, whispId)).then((r) => r[0]) : undefined;
      const sender = whisp ? await db.select().from(usersTable).where(eq(usersTable.id, whisp.senderId)).then((r) => r[0]) : undefined;
      if (whisp && sender?.email) {
        void sendEmail(sender.email, "They needed to hear that 💜", appreciationNotificationEmailHtml(whisp.videoTitle), {
          whispId: whisp.id,
          purpose: "appreciation_notification",
        });
      }
    }
    void notifyUser(n.targetUserId, n.title, n.body, n.url ?? "");
  }
  return dispatched;
}

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

    // Own try block for the same reason as the one above.
    try {
      const count = await dispatchDueDeferredNotifications();
      if (count) logger.info({ count }, "Dispatched deferred notifications");
    } catch (err) {
      logger.error({ err }, "Deferred notification dispatch failed");
      reportSystemError(err, "scheduler:replyNotificationScheduler:deferred");
    }
  }, POLL_INTERVAL_MS);
}
