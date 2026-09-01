import { pgTable, text, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// One row per live visitor — signed-in OR anonymous — kept fresh by a
// periodic heartbeat ping from the frontend (see routes/visitorPing.ts),
// upserted in place rather than appended: this is a "who's here right now"
// roster, not a history log (feature_events.ts already covers historical
// usage; this table only ever answers "as of the last ~2 minutes"). Admin-
// only aggregate, same posture as lib/presence.ts's online-now count: never
// exposed to any end user, and deliberately not gated by an individual's
// own showOnlineStatus privacy toggle (see routes/admin.ts's users/online-now
// comment) — an anonymous operator headcount isn't the same disclosure as
// showing one person online to another.
export const visitorSessionsTable = pgTable("visitor_sessions", {
  // A stable per-visitor key computed server-side, NOT a random row id — a
  // ping upserts onto this key so one visitor's row updates in place
  // instead of the table growing one row per ping forever. "u:<userId>" for
  // a signed-in visitor, "v:<visitorId>" for anonymous (visitorId is the
  // client-generated UUID from lib/anonymousVisitor.ts) — see
  // lib/visitorTracking.ts's sessionKeyFor().
  id: text("id").primaryKey(),
  // Exactly one of these two is set, never both and never neither — a ping
  // is always either an authenticated request or an anonymous one.
  userId: text("user_id"),
  visitorId: text("visitor_id"),
  // Best-effort, from lib/geoip.ts — same ip-api.com lookup signup already
  // uses, but cached by IP here (lib/visitorTracking.ts) since a live
  // roster pings far more often than signup ever does and ip-api.com's
  // free tier can't take a lookup per ping. Null on lookup failure/private
  // IP, same as users.country.
  country: text("country"),
  // 'mobile' | 'tablet' | 'desktop' | 'unknown' — see lib/deviceType.ts.
  // Never richer than this (no browser/OS fingerprinting): country + device
  // class is what "who's on the platform right now" product-analytics needs,
  // not a full UA breakdown.
  deviceType: text("device_type").notNull(),
  lastPingAt: timestamp("last_ping_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  // Every "who's online right now" read is a range scan on this column —
  // it's the only thing either admin endpoint filters on.
  index("visitor_sessions_last_ping_at_idx").on(table.lastPingAt),
]);

export const insertVisitorSessionSchema = createInsertSchema(visitorSessionsTable).omit({ createdAt: true });
export type InsertVisitorSession = z.infer<typeof insertVisitorSessionSchema>;
export type VisitorSession = typeof visitorSessionsTable.$inferSelect;
