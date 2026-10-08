import { pgTable, text, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// A short debate prompt a signed-in Whisperer posts anonymously to the
// public Debate Topics feed — e.g. "Is honesty always the best policy?".
// Deliberately its own table rather than reusing whisps: a debate topic
// isn't a video and has no recipient, just a single character-capped text
// field (see MAX_TOPIC_TEXT_LENGTH in routes/debateTopics.ts — enforced
// server-side via zod at write time, title/subtitle length by product
// design: a headline to react to, not a paragraph to read).
//
// authorId identifies the account for ownership (retracting the topic) and
// for badging the author's own comments in its thread (isPoster, see
// debate_topic_comments.ts) — it is NEVER returned to any viewer, same
// anonymity posture as every other posting surface in this app (see
// routes/debateTopics.ts, which omits it from every public response).
export const debateTopicsTable = pgTable("debate_topics", {
  id: text("id").primaryKey(),
  authorId: text("author_id").notNull(),
  topicText: text("topic_text").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  // Author-initiated soft delete/retraction, same pattern as
  // whisps.deletedBySenderAt. Unlike that column (which only hides a whisp
  // from the sender's OWN views while the recipient's link keeps working), a
  // retracted debate topic is meant to come down entirely — the public feed
  // and detail lookup both exclude a row once this is set (routes/
  // debateTopics.ts). The row and its comment thread are kept, not erased,
  // for admin/moderation history.
  deletedByAuthorAt: timestamp("deleted_by_author_at", { withTimezone: true }),
  // Admin-initiated takedown — same observable effect as deletedByAuthorAt
  // (excluded from the public feed and detail lookup) but tracked
  // separately for accountability: an author's own retraction and an
  // admin's moderation action are different events, and support/appeals
  // need to be able to tell which one happened. Set via POST
  // /admin/moderation/flags/:id/remove-content (routes/admin.ts).
  removedByAdminAt: timestamp("removed_by_admin_at", { withTimezone: true }),
  // 'user' | 'admin_agent' — whether a person posted this, or the admin's
  // scheduled debate-topic agent did (lib/debateAgent.ts). authorId alone
  // can't answer this (it's never exposed publicly either way, and the
  // agent posts under its own reserved system account — see
  // lib/systemUser.ts), so admin tooling needs this to tell them apart.
  // Never shown to public readers, only in the admin panel.
  postedBy: text("posted_by").notNull().default("user"),
}, (table) => [
  // Powers the cursor-paginated public feed, newest first.
  index("debate_topics_created_at_idx").on(table.createdAt),
  // "every topic this Whisperer has posted" for ownership checks on
  // retraction.
  index("debate_topics_author_id_idx").on(table.authorId),
]);

export const insertDebateTopicSchema = createInsertSchema(debateTopicsTable).omit({ createdAt: true });
export type InsertDebateTopic = z.infer<typeof insertDebateTopicSchema>;
export type DebateTopic = typeof debateTopicsTable.$inferSelect;
