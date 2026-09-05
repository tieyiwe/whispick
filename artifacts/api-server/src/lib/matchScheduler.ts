import { db, whispsTable } from "@workspace/db";
import { eq, and, isNull } from "drizzle-orm";
import { matchGhostBoostWhisp } from "./matching";
import { logger } from "./logger";
import { reportSystemError } from "./bugRabbit";

const POLL_INTERVAL_MS = 10 * 60 * 1000; // matching isn't time-critical
// Same bounded-sweep reasoning as lib/scheduler.ts's BATCH_LIMIT — each
// pending campaign here costs its own matchGhostBoostWhisp() call (several
// queries plus up to MAX_MATCHES_PER_SEND emails), run sequentially. Leftover
// campaigns are just as "pending" ten minutes from now on the next sweep.
const BATCH_LIMIT = 100;

// Ghost Boost campaign rows: deliveryMethod='ghost_boost', status='pending',
// and groupSendId IS NULL (a fanned-out per-subscriber delivery has
// groupSendId set to its campaign's id — this excludes those, since they're
// already 'delivered' and aren't campaigns themselves).
export function startMatchScheduler(): void {
  setInterval(async () => {
    try {
      const appUrl = process.env.PUBLIC_APP_URL;
      if (!appUrl) {
        logger.warn("PUBLIC_APP_URL is not set; Ghost Boost matching is paused until it's configured");
        return;
      }

      const pending = await db
        .select()
        .from(whispsTable)
        .where(and(eq(whispsTable.deliveryMethod, "ghost_boost"), eq(whispsTable.status, "pending"), isNull(whispsTable.groupSendId)))
        .limit(BATCH_LIMIT);

      if (pending.length === 0) return;

      let newMatchesThisSweep = 0;
      for (const whisp of pending) {
        const { newMatches, totalMatched, done } = await matchGhostBoostWhisp(whisp, appUrl);
        newMatchesThisSweep += newMatches;
        if (done) {
          // 'delivered' if it ever reached anyone over its whole window,
          // 'failed' if the window closed (or quota logic ended it) having
          // never matched a single subscriber — an honest terminal state
          // rather than a silent-forever "pending".
          await db
            .update(whispsTable)
            .set({ status: totalMatched > 0 ? "delivered" : "failed", deliveredAt: totalMatched > 0 ? new Date() : null })
            .where(eq(whispsTable.id, whisp.id));
        }
      }

      if (newMatchesThisSweep > 0) {
        logger.info({ campaigns: pending.length, newMatchesThisSweep }, "Ghost Boost matching sweep complete");
      }
    } catch (err) {
      logger.error({ err }, "Ghost Boost matching sweep failed");
      reportSystemError(err, "scheduler:matchScheduler");
    }
  }, POLL_INTERVAL_MS);
}
