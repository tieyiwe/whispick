import { pgTable, text, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// One row per call to the "Not sure what to send?" AI concierge on the Send
// Whisp composer (see lib/concierge.ts) — the sender's own free-text
// situation, matched against the existing Suggestions Library (see
// suggested_videos.ts) rather than discovering anything new (that's
// suggestionAgent.ts's separate background job), plus a single drafted
// anonymous note. Kept as its own table (rather than being stateless like
// note-suggestions) so the admin panel has something to count usage from,
// and so whisps.conciergeRequestId has a row to point back to when a
// concierge session actually leads to a send.
export const conciergeRequestsTable = pgTable("concierge_requests", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  // The sender's own free-text description of their situation — their own
  // words, same ownership posture as whisps.anonymousNote (not third-party
  // scraped content) — kept so admins can see what people are asking for.
  situation: text("situation").notNull(),
  // The fixed taxonomy keys (lib/categorize.ts's VIDEO_CATEGORIES) the model
  // picked out of the situation text — never freeform, so this always lines
  // up with suggested_videos.categories for the overlap match in
  // lib/concierge.ts. Empty array when nothing in the taxonomy fit.
  matchedCategories: text("matched_categories").array().notNull(),
  // Suggestions Library ids surfaced for this request, ranked best-first —
  // empty when nothing in the library matched well enough (the concierge
  // falls back to "here's a note draft, you pick the video" in that case).
  suggestedVideoIds: text("suggested_video_ids").array().notNull(),
  noteDraft: text("note_draft"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("concierge_requests_user_id_idx").on(table.userId),
]);

export const insertConciergeRequestSchema = createInsertSchema(conciergeRequestsTable).omit({ createdAt: true });
export type InsertConciergeRequest = z.infer<typeof insertConciergeRequestSchema>;
export type ConciergeRequest = typeof conciergeRequestsTable.$inferSelect;
