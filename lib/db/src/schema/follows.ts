import { pgTable, text, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// A follow relationship between two accounts, scoped to their public
// whispererHandle identity (users.whispererHandle) — following someone
// means "show me their future Debate Topics in my following feed," and
// works identically whether they're followed as a topic's author or as a
// commentator, since both are ultimately just the same persistent account
// identity (see users.whispererHandle's comment). One row per
// (followerUserId, followedUserId) — idempotent toggle, same model
// circle_post_likes/comment_reactions use. Self-follow is rejected at the
// route layer (routes/follows.ts), not enforced here.
export const followsTable = pgTable("follows", {
  id: text("id").primaryKey(),
  followerUserId: text("follower_user_id").notNull(),
  followedUserId: text("followed_user_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("follows_follower_followed_idx").on(table.followerUserId, table.followedUserId),
  // Backs "how many people follow me" (a followed user's own stats) and,
  // separately, "everyone I follow" for the following feed.
  index("follows_followed_user_id_idx").on(table.followedUserId),
  index("follows_follower_user_id_idx").on(table.followerUserId),
]);

export const insertFollowSchema = createInsertSchema(followsTable).omit({ createdAt: true });
export type InsertFollow = z.infer<typeof insertFollowSchema>;
export type Follow = typeof followsTable.$inferSelect;
