import { pgTable, text, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// A stable, anonymous display name for one visitor within one comment
// thread — "SwiftFalcon482", not an account name. Generated automatically
// the first time a visitor posts their first comment on a Blind Circle post
// or Debate Topic (see routes/public.ts's assignOrGetHandle), so a topic
// author or fellow participant can tell "the person I'm replying to" apart
// from everyone else across a whole thread, without any of it being a real
// identity. A visitor can rename their own handle later (PATCH
// /w/:token/handle, /public/debate-topics/:id/handle) — renaming updates
// every past comment's displayed name too, since this is looked up at READ
// time (a join), never denormalized onto the comment row itself; the point
// is "this is consistently who you're talking to right now," not a
// permanent historical record.
//
// Scoped per (contentType, rootId, visitorId) — deliberately per THREAD,
// not global, so the same visitor can be "SwiftFalcon482" in one Debate
// Topic and something entirely different in another, the same way a real
// pseudonym picked per-conversation would work, and so this can never
// become a cross-thread tracking handle for one visitor.
export const anonymousHandlesTable = pgTable("anonymous_handles", {
  id: text("id").primaryKey(),
  contentType: text("content_type").notNull(), // 'circle_drop' | 'debate_topic'
  rootId: text("root_id").notNull(), // whisps.id (circle_drop) or debate_topics.id
  visitorId: text("visitor_id").notNull(),
  handle: text("handle").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("anonymous_handles_thread_visitor_idx").on(table.contentType, table.rootId, table.visitorId),
  // Backs the "is this handle already taken in this thread" check a manual
  // rename needs, so two visitors in the same thread can't collide.
  index("anonymous_handles_thread_handle_idx").on(table.contentType, table.rootId, table.handle),
]);

export const insertAnonymousHandleSchema = createInsertSchema(anonymousHandlesTable).omit({ createdAt: true });
export type InsertAnonymousHandle = z.infer<typeof insertAnonymousHandleSchema>;
export type AnonymousHandle = typeof anonymousHandlesTable.$inferSelect;
