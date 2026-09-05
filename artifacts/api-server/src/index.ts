import app from "./app";
import { logger } from "./lib/logger";
import { recordBugReport, reportSystemError } from "./lib/bugRabbit";
import { startScheduledWhispDispatcher } from "./lib/scheduler";
import { startScheduledTextWhispDispatcher } from "./lib/textWhispScheduler";
import { startReminderDispatcher } from "./lib/reminderScheduler";
import { startReplyNotificationScheduler } from "./lib/replyNotificationScheduler";
import { startMediaRetentionScheduler } from "./lib/mediaRetentionScheduler";
import { startTakeawayScheduler } from "./lib/takeawayScheduler";
import { startMatchScheduler } from "./lib/matchScheduler";
import { startSuggestionAgentScheduler } from "./lib/suggestionAgentScheduler";
import { startDebateAgentScheduler } from "./lib/debateAgentScheduler";
import { startCircleAgentScheduler } from "./lib/circleAgentScheduler";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// Last-resort BugRabbit net for anything that slips past both app.ts's
// Express error handler (only ever sees errors from the request/response
// cycle) AND each background scheduler's own try/catch (see e.g.
// reminderScheduler.ts) — a throw or rejection from ANYWHERE else in the
// process lands here. An unhandledRejection is left non-fatal (Node's own
// default posture, and the safer one: force-exiting on any incidental
// missed .catch() would turn a minor async bug into a full outage); an
// uncaughtException is NOT safe to keep running past — Node's own guidance
// is that the process may be in a corrupted state — so this reports it,
// then exits so Replit's process manager restarts clean.
process.on("uncaughtException", (err) => {
  logger.error({ err }, "Uncaught exception");
  // Awaited (unlike reportSystemError's fire-and-forget everywhere else)
  // specifically so the report's DB write actually lands before the
  // process below exits — reportSystemError alone would race the exit and
  // likely lose the write.
  void recordBugReport({
    source: "backend",
    message: err.message,
    stack: err.stack ?? null,
    url: "process:uncaughtException",
    userAgent: null,
    userId: null,
  }).finally(() => process.exit(1));
});

process.on("unhandledRejection", (reason) => {
  logger.error({ err: reason }, "Unhandled promise rejection");
  reportSystemError(reason, "process:unhandledRejection");
});

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
});

startScheduledWhispDispatcher();
startScheduledTextWhispDispatcher();
startReminderDispatcher();
startReplyNotificationScheduler();
startMediaRetentionScheduler();
startTakeawayScheduler();
startMatchScheduler();
startSuggestionAgentScheduler();
startDebateAgentScheduler();
startCircleAgentScheduler();
