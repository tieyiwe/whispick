import { pgTable, text, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// A record of whisps an automated pass flagged as possibly containing
// sexual/explicit content (see lib/moderation.ts), for admin review — not an
// automated takedown or ban. userId is the sender, denormalized from the
// whisp row so "how many times has this person been flagged" is a plain
// count query, no join required. dismissed marks a false positive an admin
// has already looked at and cleared; reviewedAt/reviewedByAdminId record
// that review happened at all (dismissed or not), separate from whether the
// verdict was "yes, act on it" vs "no, ignore it."
export const moderationFlagsTable = pgTable("moderation_flags", {
  id: text("id").primaryKey(),
  whispId: text("whisp_id").notNull(),
  userId: text("user_id").notNull(),
  severity: text("severity").notNull(), // 'low' | 'medium' | 'high' — never 'none': a 'none' verdict just isn't persisted
  reasoning: text("reasoning").notNull(),
  source: text("source").notNull().default("ai_classifier"), // 'ai_classifier' | 'admin_manual'
  dismissed: boolean("dismissed").notNull().default(false),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  reviewedByAdminId: text("reviewed_by_admin_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertModerationFlagSchema = createInsertSchema(moderationFlagsTable).omit({ createdAt: true });
export type InsertModerationFlag = z.infer<typeof insertModerationFlagSchema>;
export type ModerationFlag = typeof moderationFlagsTable.$inferSelect;
