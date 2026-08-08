import { pgTable, text, boolean, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// A record of whisps (or, since Text Whisps shipped, text_whisps — see
// contentType below) an automated pass flagged as possibly containing
// sexual/explicit content (see lib/moderation.ts), for admin review — not an
// automated takedown or ban. userId is the sender, denormalized from the
// source row so "how many times has this person been flagged" is a plain
// count query, no join required. dismissed marks a false positive an admin
// has already looked at and cleared; reviewedAt/reviewedByAdminId record
// that review happened at all (dismissed or not), separate from whether the
// verdict was "yes, act on it" vs "no, ignore it."
export const moderationFlagsTable = pgTable("moderation_flags", {
  id: text("id").primaryKey(),
  // Exactly one of whispId/textWhispId is set, per contentType below —
  // whispId stayed NOT NULL for years before Text Whisps existed, so it's
  // relaxed to nullable here rather than backfilled with a sentinel.
  whispId: text("whisp_id"),
  // Set instead of whispId when contentType is 'text_whisp' (see
  // lib/moderation.ts's moderateTextWhispAsync and text_whisps.ts).
  textWhispId: text("text_whisp_id"),
  contentType: text("content_type").notNull().default("whisp"), // 'whisp' | 'text_whisp'
  userId: text("user_id").notNull(),
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
]);

export const insertModerationFlagSchema = createInsertSchema(moderationFlagsTable).omit({ createdAt: true });
export type InsertModerationFlag = z.infer<typeof insertModerationFlagSchema>;
export type ModerationFlag = typeof moderationFlagsTable.$inferSelect;
