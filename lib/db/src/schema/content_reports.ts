import { pgTable, text, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// A user-filed report ("flag") against a piece of public Debate Now content
// — the community's own signal, distinct from moderation_flags (the
// automated classifier's signal, which has no reporter, no chosen reason,
// and nobody waiting on an answer). A report is a two-way conversation:
// the reporter picks a reason and can add detail, and an admin's
// resolution can flow BACK to them ("taken down" / "not a violation") as
// an in-app notification — moderation_flags has no one to reply to.
//
// contentType decides which of debateTopicId/debateTopicCommentId is set —
// same one-of-many FK shape moderation_flags uses. Kept to Debate Now
// content for now; adding a content type later is a new column + a new
// case in routes/admin.ts's resolve switch, not a redesign.
export const contentReportsTable = pgTable("content_reports", {
  id: text("id").primaryKey(),
  contentType: text("content_type").notNull(), // 'debate_topic' | 'debate_topic_comment'
  debateTopicId: text("debate_topic_id"),
  debateTopicCommentId: text("debate_topic_comment_id"),
  // Reporting requires a signed-in account (routes/contentReports.ts) —
  // NOT because anonymous browsers matter less, but because the whole
  // point of the admin reply flow is telling the reporter what happened,
  // and only an account can receive that notification. It also gives the
  // per-user rate limit a real key to hang on.
  reporterUserId: text("reporter_user_id").notNull(),
  // One of REPORT_REASONS in routes/contentReports.ts ('child_safety',
  // 'threat_or_violence', 'sexual_content', 'hate_speech', 'self_harm',
  // 'harassment', 'inappropriate', 'misinformation', 'spam_or_scam',
  // 'other') — validated by zod at write time, plain text here per this
  // schema's existing convention (no pg enums anywhere in it).
  reason: text("reason").notNull(),
  // Reporter's own free-text elaboration, capped at 300 WORDS (enforced
  // server-side — see MAX_DETAIL_WORDS in routes/contentReports.ts).
  detail: text("detail"),
  // Triage priority, derived from `reason` at insert time (child_safety /
  // threat_or_violence → 'critical', etc. — see REASON_PRIORITY in
  // routes/contentReports.ts) but stored, not computed on read, because an
  // admin can override it during review: a "spam" report whose detail
  // reveals a real threat should be re-triaged up without editing the
  // reporter's words.
  priority: text("priority").notNull(), // 'critical' | 'high' | 'medium' | 'low'
  // 'open' (untouched) → 'in_review' (an admin has picked it up — stops
  // two admins independently working the same report) → 'resolved'.
  status: text("status").notNull().default("open"),
  // Set only once status is 'resolved': what the admin concluded.
  // 'removed' = the content was taken down; 'no_violation' = reviewed and
  // left up.
  resolution: text("resolution"), // null | 'removed' | 'no_violation'
  // Admin-only working notes accumulated during review ("checked author
  // history, 3 prior flags") — never shown to the reporter or the author.
  adminNotes: text("admin_notes"),
  // The message actually sent back to the reporter at resolve time (null =
  // resolved silently) — stored verbatim for the audit trail, since the
  // notification row it becomes doesn't reference this report.
  adminReplyMessage: text("admin_reply_message"),
  // Set when the admin sent the content's author a guidelines warning as
  // part of resolving this report. Null when no warning went out —
  // including the case where none COULD go out (an anonymous no-account
  // commenter has nowhere to receive one).
  authorWarnedAt: timestamp("author_warned_at", { withTimezone: true }),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  resolvedByAdminId: text("resolved_by_admin_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  // The admin queue's default view: open reports ordered by priority —
  // status is the leftmost column since every queue read filters on it.
  index("content_reports_status_priority_idx").on(table.status, table.priority),
  // Dedup check on file: "has this user already got an open report on this
  // exact content" (routes/contentReports.ts).
  index("content_reports_reporter_user_id_idx").on(table.reporterUserId),
  index("content_reports_debate_topic_id_idx").on(table.debateTopicId),
  index("content_reports_debate_topic_comment_id_idx").on(table.debateTopicCommentId),
]);

export const insertContentReportSchema = createInsertSchema(contentReportsTable).omit({ createdAt: true });
export type InsertContentReport = z.infer<typeof insertContentReportSchema>;
export type ContentReport = typeof contentReportsTable.$inferSelect;
