import { runCircleContentAgentSweep } from "./circleContentAgent";
import { logger } from "./logger";
import { reportSystemError } from "./bugRabbit";

// Once a day is plenty — this posts a small, config-bounded number of
// videos, not a real-time feed, same cadence reasoning as
// suggestionAgentScheduler.ts/debateAgentScheduler.ts.
// runCircleContentAgentSweep() itself no-ops unless an admin has explicitly
// enabled the feature.
const POLL_INTERVAL_MS = 24 * 60 * 60 * 1000;

export function startCircleAgentScheduler(): void {
  setInterval(async () => {
    try {
      await runCircleContentAgentSweep();
    } catch (err) {
      logger.error({ err }, "Circle content agent sweep failed");
      reportSystemError(err, "scheduler:circleAgentScheduler");
    }
  }, POLL_INTERVAL_MS);
}
