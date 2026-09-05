import { pgTable, text, integer, boolean, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// BugRabbit — an in-house, Sentry-shaped error tracker. Two tables, same
// split Sentry itself uses: bugIssues is one row per DISTINCT bug (grouped
// by `fingerprint`, see lib/bugRabbit.ts's fingerprint()), bugOccurrences is
// one row per individual time it actually happened, capped per issue (see
// MAX_STORED_OCCURRENCES in lib/bugRabbit.ts) so a hot error loop can't
// write unbounded rows — the issue's occurrenceCount/lastSeenAt still keep
// counting past the cap, only the detailed occurrence rows stop
// accumulating. Every free-text field on both tables (message, stack, url)
// is scrubbed via lib/piiScrub.ts BEFORE it ever reaches this table — never
// raw user input.
export const bugIssuesTable = pgTable("bug_issues", {
  id: text("id").primaryKey(),
  // Stable grouping key — same underlying bug, different occurrences,
  // collapse into the same issue instead of flooding the queue with
  // duplicates. See lib/bugRabbit.ts's fingerprint().
  fingerprint: text("fingerprint").notNull().unique(),
  source: text("source").notNull(), // 'frontend' | 'backend'
  // Scrubbed, truncated error message — what the admin list actually reads.
  message: text("message").notNull(),
  occurrenceCount: integer("occurrence_count").notNull().default(1),
  firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  resolved: boolean("resolved").notNull().default(false),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  resolvedByAdminId: text("resolved_by_admin_id"),
}, (table) => [
  // The admin queue's default view: unresolved issues by recency —
  // resolved is the leftmost column since every queue read filters on it.
  index("bug_issues_resolved_last_seen_idx").on(table.resolved, table.lastSeenAt),
]);

// One row per occurrence, capped at MAX_STORED_OCCURRENCES per issue —
// enough to see a pattern (which users, which routes, whether the stack
// varies) without an unbounded table under a genuinely hot error.
export const bugOccurrencesTable = pgTable("bug_occurrences", {
  id: text("id").primaryKey(),
  issueId: text("issue_id").notNull(),
  // Scrubbed stack trace, capped length — null when the source event had
  // none (e.g. a bare window.onerror with no Error object).
  stack: text("stack"),
  // Scrubbed page path (frontend) or request path (backend) — query string
  // stripped before storage since it can carry tokens (see piiScrub.ts).
  url: text("url"),
  userAgent: text("user_agent"),
  // Set only when the event carried a signed-in session — never inferred,
  // never joined against phone/email here (see whisperBoxHandlePersonalized
  // and other schema comments on the anti-enumeration discipline this
  // codebase holds elsewhere; the same "don't expose more than the report
  // needs" reasoning applies to a crashed anonymous visitor too).
  userId: text("user_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("bug_occurrences_issue_id_idx").on(table.issueId),
]);

export const insertBugIssueSchema = createInsertSchema(bugIssuesTable);
export type InsertBugIssue = z.infer<typeof insertBugIssueSchema>;
export type BugIssue = typeof bugIssuesTable.$inferSelect;

export const insertBugOccurrenceSchema = createInsertSchema(bugOccurrencesTable).omit({ createdAt: true });
export type InsertBugOccurrence = z.infer<typeof insertBugOccurrenceSchema>;
export type BugOccurrence = typeof bugOccurrencesTable.$inferSelect;
