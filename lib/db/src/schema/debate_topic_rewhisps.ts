import { pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// A "rewhisp" — the Debate Topics equivalent of a retweet/repost: a visitor
// boosts a topic's visibility without adding anything of their own,
// entirely anonymous like everything else here (no list of who rewhisped
// it is ever exposed, only a count). One row per (debateTopicId, visitorId)
// — idempotent, same toggle model circle_post_likes uses for likes; a
// visitor rewhisping a topic they already rewhisped just un-does it.
export const debateTopicRewhispsTable = pgTable("debate_topic_rewhisps", {
  id: text("id").primaryKey(),
  debateTopicId: text("debate_topic_id").notNull(),
  visitorId: text("visitor_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("debate_topic_rewhisps_topic_visitor_idx").on(table.debateTopicId, table.visitorId),
]);

export const insertDebateTopicRewhispSchema = createInsertSchema(debateTopicRewhispsTable).omit({ createdAt: true });
export type InsertDebateTopicRewhisp = z.infer<typeof insertDebateTopicRewhispSchema>;
export type DebateTopicRewhisp = typeof debateTopicRewhispsTable.$inferSelect;
