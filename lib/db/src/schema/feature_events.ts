import { pgTable, text, integer, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Internal product analytics: which buttons/features actually get used,
// and which don't — the evidence base for trimming clutter and redesign
// decisions (see routes/usageEvents.ts for capture and routes/admin.ts's
// usage-stats/usage-insights for the reading side).
//
// One row is NOT one click: the client aggregates counts per feature over
// its flush window (lib/featureUsage.ts) and ships {feature, count} pairs,
// so a busy session writes a handful of rows instead of hundreds. Feature
// keys are the app's existing data-testid values with volatile id segments
// normalized out — no new instrumentation attribute to maintain, and no
// free-text content is ever stored here.
export const featureEventsTable = pgTable("feature_events", {
  id: text("id").primaryKey(),
  feature: text("feature").notNull(),
  // Set when the actor was signed in — lets stats distinguish "used a lot
  // by everyone" from "used a lot by one person." Null for anonymous
  // visitors (public pages count too).
  userId: text("user_id"),
  count: integer("count").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("feature_events_feature_idx").on(table.feature),
  // The stats window filter ("last N days") always constrains on this.
  index("feature_events_created_at_idx").on(table.createdAt),
]);

export const insertFeatureEventSchema = createInsertSchema(featureEventsTable).omit({ createdAt: true });
export type InsertFeatureEvent = z.infer<typeof insertFeatureEventSchema>;
export type FeatureEvent = typeof featureEventsTable.$inferSelect;
