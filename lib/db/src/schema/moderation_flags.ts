import { pgTable, text, boolean, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// A record of whisps (or, since Text Whisps, Blind Circle comments, and
// Debate Topics shipped, text_whisps/circle_comments/debate_topics/
// debate_topic_comments — see contentType below) an automated pass flagged
// as possibly containing sexual/explicit or dangerous/harmful content (see
// lib/moderation.ts), for admin review — not an automated takedown or ban.
// userId is the sender, denormalized from the source row so "how many times
// has this person been flagged" is a plain count query, no join required.
// dismissed marks a false positive an admin has already looked at and
// cleared; reviewedAt/reviewedByAdminId record that review happened at all
// (dismissed or not), separate from whether the verdict was "yes, act on
// it" vs "no, ignore it."
export const moderationFlagsTable = pgTable("moderation_flags", {
  id: text("id").primaryKey(),
  // Exactly one of whispId/textWhispId/circleCommentId/debateTopicId/
  // debateTopicCommentId is set, per contentType below — whispId stayed NOT
  // NULL for years before Text Whisps existed, so it's relaxed to nullable
  // here rather than backfilled with a sentinel.
  whispId: text("whisp_id"),
  // Set instead of whispId when contentType is 'text_whisp' (see
  // lib/moderation.ts's moderateTextWhispAsync and text_whisps.ts).
  textWhispId: text("text_whisp_id"),
  // Set instead when contentType is 'circle_comment' (see
  // lib/moderation.ts's moderateCircleCommentAsync and circle_comments.ts).
  circleCommentId: text("circle_comment_id"),
  // Set instead when contentType is 'debate_topic' (see
  // lib/moderation.ts's moderateDebateTopicAsync and debate_topics.ts).
  debateTopicId: text("debate_topic_id"),
  // Set instead when contentType is 'debate_topic_comment' (see
  // lib/moderation.ts's moderateDebateTopicCommentAsync and
  // debate_topic_comments.ts).
  debateTopicCommentId: text("debate_topic_comment_id"),
  // Set instead when contentType is 'whisper_box_message' (see
  // lib/moderation.ts's moderateWhisperBoxMessageAsync and
  // whisper_box_messages.ts). userId is ALWAYS null for this content
  // type — there is no sender account at all, by design (see that table's
  // schema comment).
  whisperBoxMessageId: text("whisper_box_message_id"),
  contentType: text("content_type").notNull().default("whisp"), // 'whisp' | 'text_whisp' | 'circle_comment' | 'debate_topic' | 'debate_topic_comment' | 'whisper_box_message'
  // Nullable for the anonymous-sender content types ('circle_comment',
  // 'debate_topic_comment', 'whisper_box_message'): those can come from a
  // fully anonymous, no-account visitor with no userId to attribute it to.
  // maybeWarnUser (lib/moderation.ts) is skipped when null — there's no
  // account to warn, and nothing here identifies the visitor beyond their
  // own device's local, unlinked visitorId, which this table never stores.
  userId: text("user_id"),
  severity: text("severity").notNull(), // 'low' | 'medium' | 'high' — never 'none': a 'none' verdict just isn't persisted
  reasoning: text("reasoning").notNull(),
  source: text("source").notNull().default("ai_classifier"), // 'ai_classifier' | 'admin_manual'
  dismissed: boolean("dismissed").notNull().default(false),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  reviewedByAdminId: text("reviewed_by_admin_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("moderation_flags_user_id_idx").on(table.userId),
  index("moderation_flags_whisp_id_idx").on(table.whispId),
  index("moderation_flags_text_whisp_id_idx").on(table.textWhispId),
  index("moderation_flags_circle_comment_id_idx").on(table.circleCommentId),
  index("moderation_flags_debate_topic_id_idx").on(table.debateTopicId),
  index("moderation_flags_debate_topic_comment_id_idx").on(table.debateTopicCommentId),
  index("moderation_flags_whisper_box_message_id_idx").on(table.whisperBoxMessageId),
]);

export const insertModerationFlagSchema = createInsertSchema(moderationFlagsTable).omit({ createdAt: true });
export type InsertModerationFlag = z.infer<typeof insertModerationFlagSchema>;
export type ModerationFlag = typeof moderationFlagsTable.$inferSelect;
