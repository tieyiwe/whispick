import { runDebateTopicAgentSweep } from "./debateAgent";
import { logger } from "./logger";
import { reportSystemError } from "./bugRabbit";

// Once a day is plenty — this posts a small, config-bounded number of
// topics, not a real-time feed, same cadence reasoning as
// suggestionAgentScheduler.ts. runDebateTopicAgentSweep() itself no-ops
// unless an admin has explicitly enabled the feature.
const POLL_INTERVAL_MS = 24 * 60 * 60 * 1000;

export function startDebateAgentScheduler(): void {
  setInterval(async () => {
    try {
      await runDebateTopicAgentSweep();
    } catch (err) {
      logger.error({ err }, "Debate topic agent sweep failed");
      reportSystemError(err, "scheduler:debateAgentScheduler");
    }
  }, POLL_INTERVAL_MS);
}
