import { pgTable, text, timestamp, index, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// One row = one anonymous visitor's "like" on a Blind Circle post
// (whisp.deliveryMethod = 'circle_drop'). visitorId is the same
// client-generated, localStorage-persisted id circle_comments.ts uses — an
// opaque per-device token, never linked to a real identity, never returned
// to any other viewer. The unique constraint on (whispId, visitorId) is
// what makes a like idempotent: the same visitor liking twice is a no-op at
// the DB level regardless of any client-side bug, and unliking is a plain
// delete of that row rather than a soft-toggle flag.
export const circlePostLikesTable = pgTable("circle_post_likes", {
  id: text("id").primaryKey(),
  whispId: text("whisp_id").notNull(),
  visitorId: text("visitor_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("circle_post_likes_whisp_id_idx").on(table.whispId),
  unique("circle_post_likes_whisp_id_visitor_id_unique").on(table.whispId, table.visitorId),
]);

export const insertCirclePostLikeSchema = createInsertSchema(circlePostLikesTable).omit({ createdAt: true });
export type InsertCirclePostLike = z.infer<typeof insertCirclePostLikeSchema>;
export type CirclePostLike = typeof circlePostLikesTable.$inferSelect;
