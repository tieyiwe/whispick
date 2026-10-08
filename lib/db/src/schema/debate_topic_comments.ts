import { pgTable, text, boolean, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// A public comment on a Debate Topic (debate_topics.ts). Deliberately its
// own table rather than reusing whisp_replies: that table's private
// one-anonymous-party-to-the-sender thread is the wrong visibility shape for
// a comment section everyone browsing the topic sees — same reasoning
// Blind Circle's own public comment thread is built on.
//
// Fully anonymous by design: no account is required to comment (see
// routes/debateTopics.ts). visitorId is a random id the CLIENT generates and
// persists in localStorage (lib/anonymousVisitor.ts) purely so this device's
// own recent comments can be counted for the anonymous rate limit
// (lib/plans.ts's canPostAnonymousComment) — it is never returned to any
// other viewer, and never linked to a real identity. It's set even for a
// signed-in commenter (including the topic's own author), for schema
// simplicity; a signed-in author's comments are just exempt from the rate
// limit itself.
export const debateTopicCommentsTable = pgTable("debate_topic_comments", {
  id: text("id").primaryKey(),
  topicId: text("topic_id").notNull(),
  visitorId: text("visitor_id").notNull(),
  commentText: text("comment_text").notNull(),
  // The comment this one answers, when it's a reply to a specific earlier
  // comment rather than the thread as a whole — same flat quote-reference
  // model as whisp_replies.parentReplyId (see that column's comment for why
  // it's flat rather than a real nested tree). Null for an ordinary
  // top-level comment. Constrained to a comment on the SAME topic at write
  // time (see routes/debateTopics.ts).
  parentCommentId: text("parent_comment_id"),
  // True only when the commenter was signed in AND is the topic's own
  // author at write time (see routes/debateTopics.ts) — badges their
  // comment as "Poster" without revealing anything about who they actually
  // are, same anonymity posture as everywhere else in the app: what's
  // revealed is a ROLE, never an identity.
  isPoster: boolean("is_poster").notNull().default(false),
  // The commenter's real account id, set only when they were signed in at
  // post time — never returned in any public response (the comment always
  // displays only via its anonymous_handles handle/isPoster), same
  // anonymous-display-but-internally-attributed pattern moderation_flags.
  // userId already uses. Its ONLY purpose is notification routing: without
  // it there is no way to tell a reply/reaction "your comment got a
  // response" when the recipient is a real account, since visitorId alone
  // resolves to nothing server-side. Null for a genuinely anonymous
  // (never-signed-in) commenter, who simply can't be notified.
  authorUserId: text("author_user_id"),
  // An optional image attached to the comment — object storage key plus a
  // read-time-resolved URL, same split lib/objectStorage.ts's video/photo
  // pipeline already uses. Screened the same way comment TEXT already is
  // (see lib/moderation.ts's moderateDebateTopicCommentAsync, extended to
  // classify the image too when present) — imageModerationStatus tracks
  // that pass independently of the text one, since an image can take
  // longer to classify and a comment shouldn't wait on it to post.
  imageObjectKey: text("image_object_key"),
  imageModerationStatus: text("image_moderation_status"), // null (no image, or not yet checked) | 'ok' | 'flagged'
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  // Admin-initiated takedown of just this one comment — same reasoning as
  // debate_topics.removedByAdminAt, tracked separately from nothing-else
  // (a comment has no author-retraction path of its own today). Excluded
  // from every thread read once set (routes/debateTopics.ts).
  removedByAdminAt: timestamp("removed_by_admin_at", { withTimezone: true }),
}, (table) => [
  index("debate_topic_comments_topic_id_idx").on(table.topicId),
  index("debate_topic_comments_author_user_id_idx").on(table.authorUserId),
  // Backs the anonymous rate-limit check: "how many comments has this
  // visitor posted (anywhere) in the last COMMENT_LIMIT_WINDOW_HOURS."
  index("debate_topic_comments_visitor_id_created_at_idx").on(table.visitorId, table.createdAt),
]);

export const insertDebateTopicCommentSchema = createInsertSchema(debateTopicCommentsTable).omit({ createdAt: true });
export type InsertDebateTopicComment = z.infer<typeof insertDebateTopicCommentSchema>;
export type DebateTopicComment = typeof debateTopicCommentsTable.$inferSelect;
