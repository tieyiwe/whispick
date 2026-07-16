import { pgTable, text, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// A video can carry up to 3 ranked category tags (rank 1 = closest fit),
// derived from title + (best-effort) transcript keyword scoring — see
// lib/categorize.ts. Re-derived (rows replaced) each time a whisp is created.
export const whispCategoriesTable = pgTable("whisp_categories", {
  id: text("id").primaryKey(),
  whispId: text("whisp_id").notNull(),
  category: text("category").notNull(),
  rank: integer("rank").notNull(), // 1 (best fit) .. 3 (least, among the chosen top 3)
  score: integer("score").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertWhispCategorySchema = createInsertSchema(whispCategoriesTable).omit({ createdAt: true });
export type InsertWhispCategory = z.infer<typeof insertWhispCategorySchema>;
export type WhispCategory = typeof whispCategoriesTable.$inferSelect;
