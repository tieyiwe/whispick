import { db } from "@workspace/db";
import { whispsTable, uploadedVideosTable } from "@workspace/db";
import { eq, and, lte, count } from "drizzle-orm";
import { deliverWhisperLink } from "./deliver";
import { groupHookLine } from "./copy";
import { computeExpiresAt } from "./expiration";
import { notifyUserPersisted } from "./push";
import { logger } from "./logger";

const POLL_INTERVAL_MS = 60_000;
// Bounds the work done per sweep regardless of how large the due backlog
// gets (same reasoning as lib/takeawayScheduler.ts's BATCH_LIMIT) — this loop
// awaits a real Twilio/Resend send per row sequentially, so an unbounded
// due-count (e.g. a pile of scheduled sends all coming due around the same
// moment) would otherwise make one sweep run long enough to overlap the
// next. Any leftover due rows are simply picked up on the next poll, still
// only 60s away.
const BATCH_LIMIT = 100;

// Only recipient-directed methods get the 48-hour link expiry — a scheduled
// circle_drop lands in a feed with no single recipient and must never expire
// (lib/expiration.ts states the invariant; stamping it here used to kill
// scheduled Circle posts 48h after they went live).
function expiresForMethod(deliveryMethod: string): Date | null {
  return deliveryMethod === "whisper_link" || deliveryMethod === "group_whisper" ? computeExpiresAt() : null;
}

// Delivers whisps whose scheduledAt has come due. There's no incoming HTTP
// request here to derive a safe app URL from (unlike the immediate-send
// path), so this requires PUBLIC_APP_URL to be set explicitly — building an
// email/SMS link from a guessed host isn't acceptable for something we
// actually send to a third party. Due whisps are left in "scheduled" state
// (retried next poll) until it's configured, rather than being marked
// delivered without actually notifying anyone.
export function startScheduledWhispDispatcher(): void {
  setInterval(async () => {
    try {
      const due = await db
        .select()
        .from(whispsTable)
        .where(and(eq(whispsTable.status, "scheduled"), lte(whispsTable.scheduledAt, new Date())))
        .limit(BATCH_LIMIT);

      if (due.length === 0) return;

      const appUrl = process.env.PUBLIC_APP_URL;
      if (!appUrl) {
        logger.warn(
          { count: due.length },
          "PUBLIC_APP_URL is not set; scheduled whisps are due but will stay queued until it's configured",
        );
        return;
      }

      for (const whisp of due) {
        // Claim the row FIRST with a conditional flip out of 'scheduled':
        // this loop awaits a real Twilio/Resend send per row, so a sweep
        // that outruns the 60s poll interval would otherwise re-select the
        // still-'scheduled' tail and deliver those whisps twice. Zero rows
        // updated = another sweep (or a concurrent process) already owns it.
        const claimed = await db
          .update(whispsTable)
          .set({ status: "delivered", deliveredAt: new Date(), expiresAt: expiresForMethod(whisp.deliveryMethod) })
          .where(and(eq(whispsTable.id, whisp.id), eq(whispsTable.status, "scheduled")))
          .returning({ id: whispsTable.id });
        if (claimed.length === 0) continue;

        // A far-future schedule can outlive an attached uploaded video's
        // retention window (see lib/uploads.ts) — sending the link out
        // anyway would hand the recipient a dead video. Check freshly at
        // dispatch time rather than trusting whatever was true when the
        // whisp was created.
        if (whisp.uploadedVideoId) {
          const media = await db
            .select({ status: uploadedVideosTable.status })
            .from(uploadedVideosTable)
            .where(eq(uploadedVideosTable.id, whisp.uploadedVideoId))
            .then((r) => r[0]);

          if (!media || media.status !== "ready") {
            await db.update(whispsTable).set({ status: "failed" }).where(eq(whispsTable.id, whisp.id));
            void notifyUserPersisted(
              whisp.senderId,
              "A scheduled whisp couldn't be sent",
              "The video you uploaded is no longer available, so this scheduled whisp wasn't delivered.",
              `/whisps/${whisp.id}`,
            );
            continue;
          }
        }

        // Status was already claimed as 'delivered' above ("delivery
        // attempted", matching the immediate-send path's semantics);
        // deliverWhisperLink flips it to 'failed' itself (and logs why —
        // see delivery_attempts) when the transport rejects the send.
        if (whisp.deliveryMethod === "whisper_link") {
          await deliverWhisperLink(whisp, appUrl);
        } else if (whisp.deliveryMethod === "group_whisper" && whisp.groupSendId) {
          const memberCountRow = await db
            .select({ count: count() })
            .from(whispsTable)
            .where(eq(whispsTable.groupSendId, whisp.groupSendId))
            .then((r) => r[0]);
          await deliverWhisperLink(whisp, appUrl, groupHookLine(memberCountRow?.count ?? 1));
        }
      }

      logger.info({ count: due.length }, "Dispatched scheduled whisps");
    } catch (err) {
      logger.error({ err }, "Scheduled whisp dispatch failed");
    }
  }, POLL_INTERVAL_MS);
}
