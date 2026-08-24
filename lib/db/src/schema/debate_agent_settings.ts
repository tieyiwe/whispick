import { pgTable, text, timestamp, boolean, integer } from "drizzle-orm/pg-core";

// A single-row config+status table (always id="singleton", same convention
// as suggestion_agent_status.ts) for the admin-controlled Debate Topic
// posting agent ("Town Crier" in admin UI copy) — see lib/debateAgent.ts.
// Config and status are combined in one table rather than split across two:
// there's exactly one admin panel screen for this feature, and it always
// wants both pieces of information (the current settings, and how the last
// run went) together.
export const debateAgentSettingsTable = pgTable("debate_agent_settings", {
  id: text("id").primaryKey(),
  // An admin must explicitly opt in — this app never auto-posts AI-generated
  // content to a public feed out of the box.
  enabled: boolean("enabled").notNull().default(false),
  // How many AI-generated debate topics to post per scheduled sweep.
  // Admin-adjustable within a small bound (1-10, enforced in the admin
  // route's zod schema, not here) — see routes/adminDebateAgent.ts.
  dailyPostCount: integer("daily_post_count").notNull().default(3),
  // Short theme/category strings an admin can edit (e.g. "Relationships &
  // dating", "Trending news") that steer what the agent generates each run
  // — same text-array convention as suggested_videos.categories /
  // match_subscribers.categories.
  topics: text("topics")
    .array()
    .notNull()
    .default(["Relationships & dating", "Money & work", "Trending news", "Ethics & morality", "Pop culture"]),
  lastRunAt: timestamp("last_run_at", { withTimezone: true }),
  lastRunOk: boolean("last_run_ok").notNull().default(true),
  lastErrorMessage: text("last_error_message"),
  lowCreditSuspected: boolean("low_credit_suspected").notNull().default(false),
  consecutiveFailures: integer("consecutive_failures").notNull().default(0),
  // Who last changed the config (enabled/dailyPostCount/topics), and when —
  // distinct from lastRunAt, which tracks the autonomous sweep/manual
  // trigger, not a config edit. Null until an admin has ever touched it.
  updatedByAdminId: text("updated_by_admin_id"),
  updatedAt: timestamp("updated_at", { withTimezone: true }),
});

export type DebateAgentSettings = typeof debateAgentSettingsTable.$inferSelect;
