import { runSuggestionDiscoveryAgent } from "./suggestionAgent";
import { logger } from "./logger";

// Once a day is plenty — this is a "trickle a few candidates in for admin
// review" job, not a real-time feed, and matches the daily cadence
// runSuggestionDiscoveryAgent's own category rotation assumes.
const POLL_INTERVAL_MS = 24 * 60 * 60 * 1000;

export function startSuggestionAgentScheduler(): void {
  setInterval(async () => {
    try {
      await runSuggestionDiscoveryAgent();
    } catch (err) {
      logger.error({ err }, "Suggestion discovery sweep failed");
    }
  }, POLL_INTERVAL_MS);
}
