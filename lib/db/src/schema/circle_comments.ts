import { pgTable, text, boolean, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// A public comment on a Blind Circle post (a whisp with deliveryMethod =
// 'circle_drop'). Deliberately its own table rather than reusing
// whisp_replies: replies are a private, one-anonymous-party-to-the-sender
// thread, and a Circle post's comment section needs the opposite visibility
// — everyone browsing that post sees every comment. Mixing the two models
// in one table would mean either leaking one viewer's private reply to
// every other viewer, or bolting a visibility flag onto whisp_replies that
// only ever applies to a delivery method it was never designed around.
//
// Fully anonymous by design (see PublicWhispPage/routes/public.ts): no
// account is required to comment. visitorId is a random id the CLIENT
// generates and persists in localStorage (lib/anonymousVisitor.ts) purely so
// this device's own recent comments can be counted for the anonymous rate
// limit (lib/circleEngagement.ts) — it is never returned to any other
// viewer, and never linked to a real identity. It's set even for a
// signed-in commenter (including the poster), for schema simplicity; a
// signed-in poster's comments are just exempt from the rate limit itself.
export const circleCommentsTable = pgTable("circle_comments", {
  id: text("id").primaryKey(),
  whispId: text("whisp_id").notNull(),
  visitorId: text("visitor_id").notNull(),
  commentText: text("comment_text").notNull(),
  // The comment this one answers, when it's a reply to a specific earlier
  // comment rather than the thread as a whole — same flat quote-reference
  // model as whisp_replies.parentReplyId (see that column's comment for why
  // it's flat rather than a real nested tree). Null for an ordinary
  // top-level comment. Constrained to a comment on the SAME whisp at write
  // time (see routes/public.ts), same as parentReplyId.
  parentCommentId: text("parent_comment_id"),
  // True only when the commenter was signed in AND is the whisp's own
  // sender at write time (see routes/public.ts) — badges their comment as
  // "Poster" without revealing anything about who they actually are, same
  // anonymity posture as everywhere else in the app: what's revealed is a
  // ROLE, never an identity.
  isPoster: boolean("is_poster").notNull().default(false),
  // Same notification-routing-only purpose as
  // debate_topic_comments.authorUserId — see that column's comment.
  authorUserId: text("author_user_id"),
  // An optional image attached to the comment — same object storage key +
  // read-time-resolved URL split lib/objectStorage.ts's video/photo
  // pipeline already uses, and the same independent moderation pass as
  // debate_topic_comments.imageObjectKey (see that column's comment).
  imageObjectKey: text("image_object_key"),
  imageModerationStatus: text("image_moderation_status"), // null (no image, or not yet checked) | 'ok' | 'flagged'
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  // Admin-initiated takedown of just this one comment — same reasoning as
  // debate_topics.removedByAdminAt. Excluded from every thread read once
  // set (routes/public.ts).
  removedByAdminAt: timestamp("removed_by_admin_at", { withTimezone: true }),
}, (table) => [
  index("circle_comments_whisp_id_idx").on(table.whispId),
  index("circle_comments_author_user_id_idx").on(table.authorUserId),
  // Backs the anonymous rate-limit check: "how many comments has this
  // visitor posted (anywhere) in the last 24 hours."
  index("circle_comments_visitor_id_created_at_idx").on(table.visitorId, table.createdAt),
]);

export const insertCircleCommentSchema = createInsertSchema(circleCommentsTable).omit({ createdAt: true });
export type InsertCircleComment = z.infer<typeof insertCircleCommentSchema>;
export type CircleComment = typeof circleCommentsTable.$inferSelect;
