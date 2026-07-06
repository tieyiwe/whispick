import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const trackingEventsTable = pgTable("tracking_events", {
  id: text("id").primaryKey(),
  whispId: text("whisp_id").notNull(),
  eventType: text("event_type").notNull(), // 'opened' | 'clicked' | 'watched_10s' | 'watched_50pct' | 'watched_complete'
  userAgent: text("user_agent"),
  ipHash: text("ip_hash"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertTrackingEventSchema = createInsertSchema(trackingEventsTable).omit({ createdAt: true });
export type InsertTrackingEvent = z.infer<typeof insertTrackingEventSchema>;
export type TrackingEvent = typeof trackingEventsTable.$inferSelect;
