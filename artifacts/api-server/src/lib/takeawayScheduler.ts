import { db, whispsTable } from "@workspace/db";
import { eq, and, or, lte, isNull } from "drizzle-orm";
import { generateTakeawayAsync } from "./aiTakeaway";
import { logger } from "./logger";
import { reportSystemError } from "./bugRabbit";

const POLL_INTERVAL_MS = 30 * 60 * 1000; // not time-critical — half-hourly is plenty
const UNWATCHED_NUDGE_HOURS = 6;
const BATCH_LIMIT = 50; // bound the work per sweep regardless of backlog size

// If a recipient hasn't watched their whisp in a while, generate the AI
// takeaway anyway so it's there whenever they do open it — same idea as the
// watched_complete trigger in routes/public.ts, just proactive instead of
// reactive. Scoped to whisper_link/group_whisper only: those are the only
// delivery methods with one specific tracked recipient (see
// lib/expiration.ts's identical scoping rationale).
export function startTakeawayScheduler(): void {
  setInterval(async () => {
    try {
      const cutoff = new Date(Date.now() - UNWATCHED_NUDGE_HOURS * 60 * 60 * 1000);

      const due = await db
        .select()
        .from(whispsTable)
        .where(
          and(
            isNull(whispsTable.watchedAt),
            isNull(whispsTable.aiTakeawayStatus),
            lte(whispsTable.deliveredAt, cutoff),
            or(eq(whispsTable.deliveryMethod, "whisper_link"), eq(whispsTable.deliveryMethod, "group_whisper")),
          ),
        )
        .limit(BATCH_LIMIT);

      for (const whisp of due) {
        await generateTakeawayAsync(whisp.id);
      }

      if (due.length > 0) {
        logger.info({ count: due.length }, "Generated AI takeaways for unwatched whisps");
      }
    } catch (err) {
      logger.error({ err }, "Takeaway sweep failed");
      reportSystemError(err, "scheduler:takeawayScheduler");
    }
  }, POLL_INTERVAL_MS);
}
