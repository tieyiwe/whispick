import { db } from "@workspace/db";
import { whispsTable } from "@workspace/db";
import { eq, and, lte, count } from "drizzle-orm";
import { deliverWhisperLink } from "./deliver";
import { groupHookLine } from "./copy";
import { computeExpiresAt } from "./expiration";
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
        if (whisp.deliveryMethod === "whisper_link") {
          deliverWhisperLink(whisp, appUrl);
        } else if (whisp.deliveryMethod === "group_whisper" && whisp.groupSendId) {
          const memberCountRow = await db
            .select({ count: count() })
            .from(whispsTable)
            .where(eq(whispsTable.groupSendId, whisp.groupSendId))
            .then((r) => r[0]);
          deliverWhisperLink(whisp, appUrl, groupHookLine(memberCountRow?.count ?? 1));
        }
        await db
          .update(whispsTable)
          .set({ status: "delivered", deliveredAt: new Date(), expiresAt: computeExpiresAt() })
          .where(eq(whispsTable.id, whisp.id));
      }

      logger.info({ count: due.length }, "Dispatched scheduled whisps");
    } catch (err) {
      logger.error({ err }, "Scheduled whisp dispatch failed");
    }
  }, POLL_INTERVAL_MS);
}
