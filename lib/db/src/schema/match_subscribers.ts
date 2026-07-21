import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// The other half of Ghost Boost: instead of "spend a credit, go nowhere"
// (no real ad-platform integration — see replit.md), a Ghost Boost whisp is
// matched to strangers who opted in to receive anonymous videos on topics
// they choose. No Whispick account required to subscribe — same
// no-account-needed spirit as receiving a whisp at all.
//
// Anonymous both ways: the sender never learns who specifically received
// their boost (only an aggregate count via whisps sharing its id as their
// groupSendId — see lib/matching.ts), and a subscriber never learns who
// sent a video that reached them.
export const matchSubscribersTable = pgTable("match_subscribers", {
  id: text("id").primaryKey(),
  email: text("email").notNull(),
  // Postgres native array — the category keys this subscriber wants (see
  // artifacts/api-server/src/lib/categorize.ts's VIDEO_CATEGORIES). Kept in
  // sync with the frontend's mirrored labels the same way HOOK_LINE is.
  categories: text("categories").array().notNull(),
  // A single opaque token used for both the verification link (double
  // opt-in — required before this row is match-eligible, so a stranger
  // can't sign someone else's email up to be spammed with anonymous
  // videos) and the one-click unsubscribe link. Knowing the token already
  // implies inbox access via the email it was sent to, so reusing it for
  // both actions isn't a meaningfully different exposure.
  token: text("token").unique().notNull(),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  unsubscribedAt: timestamp("unsubscribed_at", { withTimezone: true }),
  // Frequency capping: a subscriber won't be matched again until this is
  // far enough in the past (see MATCH_COOLDOWN_HOURS in lib/matching.ts) —
  // simpler and just as effective as counting sends in a rolling window.
  lastMatchedAt: timestamp("last_matched_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertMatchSubscriberSchema = createInsertSchema(matchSubscribersTable).omit({ createdAt: true });
export type InsertMatchSubscriber = z.infer<typeof insertMatchSubscriberSchema>;
export type MatchSubscriber = typeof matchSubscribersTable.$inferSelect;
