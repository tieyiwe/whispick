import { pgTable, text, integer, timestamp, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const usersTable = pgTable("users", {
  id: text("id").primaryKey(), // Clerk user ID
  clerkId: text("clerk_id").unique().notNull(),
  email: text("email").unique().notNull(),
  fullName: text("full_name"),
  avatarUrl: text("avatar_url"),
  // Synced from Clerk (sessionClaims.phone) at account creation, same
  // best-effort pattern as email/fullName in ensureUser.ts — separate from
  // whisps.recipientPhone, which is a contact this user sent TO, not their
  // own number. This value ALONE is never trustworthy proof of ownership —
  // Clerk's sync is opportunistic and unverified. It's also overwritten by
  // lib/phoneVerification.ts once a user completes the real OTP flow below,
  // in E.164 form.
  phone: text("phone"),
  // Set only by lib/phoneVerification.ts's confirm-verification route, after
  // a real one-time SMS code (Twilio Verify) was sent to `phone` and
  // confirmed back correctly — proof the user actually controls that SIM,
  // not just that they typed a number in. Null means NOT verified via our
  // own flow, regardless of whether `phone` happens to be populated from the
  // Clerk sync above. Only `phoneVerifiedAt IS NOT NULL` may ever be used to
  // decide "this phone number belongs to a known Blind Whisper user" (see
  // lib/deliver.ts's SMS/WhatsApp-skip-Twilio matching) — never `phone`
  // alone.
  phoneVerifiedAt: timestamp("phone_verified_at", { withTimezone: true }),
  // Self-reported, optional-to-decline demographic buckets — see
  // artifacts/api-server/src/lib/demographics.ts for the fixed value sets
  // and where they're collected (a one-time gate before a user's first
  // whisp send) and edited (Settings page).
  gender: text("gender"), // 'woman' | 'man' | 'nonbinary' | 'prefer_not_to_say'
  ageRange: text("age_range"), // '13-17' | '18-24' | '25-34' | '35-44' | '45-54' | '55-64' | '65+' | 'prefer_not_to_say'
  plan: text("plan").notNull().default("free"), // 'free' | 'spark' | 'ember'
  boostCredits: integer("boost_credits").notNull().default(0),
  whisperLinksUsed: integer("whisper_links_used").notNull().default(0),
  whisperLinksResetAt: timestamp("whisper_links_reset_at", { withTimezone: true }),
  stripeCustomerId: text("stripe_customer_id"),
  stripeSubscriptionId: text("stripe_subscription_id"),
  role: text("role").notNull().default("user"), // 'user' | 'admin'
  banned: boolean("banned").notNull().default(false),
  // Best-effort IP geolocation captured once at signup, for admin analytics only
  // (never shown to other users or recipients — this app's anonymity guarantee
  // is about whisp recipients not learning the sender's identity, not about
  // hiding aggregate usage geography from the app owner).
  country: text("country"),
  region: text("region"),
  city: text("city"),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
  // Opt-out, on by default: whether this Whisperer wants a "you have a new
  // whisp" email in addition to the in-app notification when someone
  // whisps them (see lib/deliver.ts's deliverWhisperLink). Never gates the
  // in-app notification itself — only the extra inbox email. Defaults to
  // true so existing rows (backfilled by the migration) and every new
  // signup keep getting email unless they explicitly turn it off in
  // Settings.
  emailNotificationsEnabled: boolean("email_notifications_enabled").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertUserSchema = createInsertSchema(usersTable).omit({ createdAt: true });
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;
