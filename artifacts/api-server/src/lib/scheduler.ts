import { db } from "@workspace/db";
import { whispsTable, uploadedVideosTable } from "@workspace/db";
import { eq, and, lte, count } from "drizzle-orm";
import { deliverWhisperLink } from "./deliver";
import { groupHookLine } from "./copy";
import { computeExpiresAt } from "./expiration";
import { notifyUserPersisted } from "./push";
import { logger } from "./logger";

const POLL_INTERVAL_MS = 60_000;

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
        .where(and(eq(whispsTable.status, "scheduled"), lte(whispsTable.scheduledAt, new Date())));

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

        let delivered = true;
        if (whisp.deliveryMethod === "whisper_link") {
          delivered = await deliverWhisperLink(whisp, appUrl);
        } else if (whisp.deliveryMethod === "group_whisper" && whisp.groupSendId) {
          const memberCountRow = await db
            .select({ count: count() })
            .from(whispsTable)
            .where(eq(whispsTable.groupSendId, whisp.groupSendId))
            .then((r) => r[0]);
          delivered = await deliverWhisperLink(whisp, appUrl, groupHookLine(memberCountRow?.count ?? 1));
        }
        // deliverWhisperLink already flipped status to 'failed' (and logged
        // why — see delivery_attempts) when the transport itself rejected
        // it; only claim 'delivered' when it actually went out.
        if (delivered) {
          await db
            .update(whispsTable)
            .set({ status: "delivered", deliveredAt: new Date(), expiresAt: computeExpiresAt() })
            .where(eq(whispsTable.id, whisp.id));
        }
      }

      logger.info({ count: due.length }, "Dispatched scheduled whisps");
    } catch (err) {
      logger.error({ err }, "Scheduled whisp dispatch failed");
    }
  }, POLL_INTERVAL_MS);
}
