import { pgTable, text, timestamp, boolean, integer } from "drizzle-orm/pg-core";

// A single-row status table (always id="singleton") tracking the AI
// discovery agent's last run — surfaced in the admin Suggestions page so an
// admin can tell "hasn't run yet" apart from "ran and found nothing" apart
// from "stopped working" (and specifically, "stopped working because the
// Anthropic account is out of credit," the case that actually needs
// action from a human, not just a retry).
export const suggestionAgentStatusTable = pgTable("suggestion_agent_status", {
  id: text("id").primaryKey(),
  lastRunAt: timestamp("last_run_at", { withTimezone: true }),
  lastRunOk: boolean("last_run_ok").notNull().default(true),
  lastErrorMessage: text("last_error_message"),
  lowCreditSuspected: boolean("low_credit_suspected").notNull().default(false),
  consecutiveFailures: integer("consecutive_failures").notNull().default(0),
});

export type SuggestionAgentStatus = typeof suggestionAgentStatusTable.$inferSelect;
