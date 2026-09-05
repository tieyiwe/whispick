import { pgTable, text, timestamp, boolean, integer } from "drizzle-orm/pg-core";

// A single-row config+status table (always id="singleton", same convention
// as debate_agent_settings.ts / suggestion_agent_status.ts) for the
// admin-controlled video-discovery posting agent ("Circle Scout" in admin UI
// copy) — see artifacts/api-server/src/lib/circleContentAgent.ts. Posts
// AI-discovered video links (never downloaded/re-hosted files — always a
// link back to the original, resolved through lib/videoMeta.ts's
// SSRF-guarded allowlist) to the PUBLIC Blind Circle feed. Config and status
// are combined in one table rather than split across two, same reasoning as
// debate_agent_settings.ts: one admin panel screen always wants both pieces
// together.
export const circleAgentSettingsTable = pgTable("circle_agent_settings", {
  id: text("id").primaryKey(),
  // An admin must explicitly opt in — this app never auto-posts AI-sourced
  // content to a public feed out of the box.
  enabled: boolean("enabled").notNull().default(false),
  // How many videos to post per scheduled sweep. Admin-adjustable within a
  // small bound (1-10, enforced in the admin route's zod schema, not here) —
  // see routes/adminCircleAgent.ts.
  dailyPostCount: integer("daily_post_count").notNull().default(3),
  // Short topic strings an admin can edit that steer what the agent searches
  // for each run — same text-array convention as debate_agent_settings.topics
  // / suggested_videos.categories. Seeded from lib/categorize.ts's
  // VIDEO_CATEGORIES labels (the taxonomy every other video-categorization
  // feature in this app already uses) so this feature doesn't invent a
  // second topic vocabulary — but the labels are duplicated here as literal
  // strings rather than imported, since lib/db can't reach into the
  // api-server package's source, and an admin is free to edit/replace them
  // via config regardless.
  topics: text("topics")
    .array()
    .notNull()
    .default([
      "Motivational & Inspirational",
      "Music",
      "Comedy",
      "Education & How-To",
      "Relationships & Love",
      "Spiritual & Faith",
      "Fitness & Health",
      "Food & Cooking",
      "Travel",
      "Gaming",
      "News & Politics",
      "Sports",
      "Family & Kids",
      "DIY & Projects",
      "Entertainment & Pop Culture",
    ]),
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

export type CircleAgentSettings = typeof circleAgentSettingsTable.$inferSelect;
