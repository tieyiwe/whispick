import { pgTable, text, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Like/dislike on a single comment — Blind Circle or Debate Topic, either
// way (commentType discriminates, same pattern moderation_flags.contentType
// uses). One row per (commentType, commentId, visitorId): a visitor can
// switch their vote or remove it, but never register twice, same idempotent
// toggle model circle_post_likes already uses for post-level likes. Counts
// are computed at read time (COUNT(*) filter), not denormalized onto the
// comment row, for the same reason circlePostLikesTable's count is —
// correctness over a saved join, and comment volume is moderation-limited
// low enough that the join cost is trivial.
export const commentReactionsTable = pgTable("comment_reactions", {
  id: text("id").primaryKey(),
  commentType: text("comment_type").notNull(), // 'circle_comment' | 'debate_topic_comment'
  commentId: text("comment_id").notNull(),
  visitorId: text("visitor_id").notNull(),
  reaction: text("reaction").notNull(), // 'like' | 'dislike'
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("comment_reactions_comment_visitor_idx").on(table.commentType, table.commentId, table.visitorId),
  index("comment_reactions_comment_idx").on(table.commentType, table.commentId),
]);

export const insertCommentReactionSchema = createInsertSchema(commentReactionsTable).omit({ createdAt: true });
export type InsertCommentReaction = z.infer<typeof insertCommentReactionSchema>;
export type CommentReaction = typeof commentReactionsTable.$inferSelect;
