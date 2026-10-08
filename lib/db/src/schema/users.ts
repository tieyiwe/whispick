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
  // Self-reported, ISO 3166-1 alpha-2 (e.g. "US", "GB", "KE") — captured
  // from the country picker in CountryPhoneInput.tsx at the moment a user
  // confirms their phone number (see routes/user.ts's
  // /phone/confirm-verification), which is both a natural low-friction
  // moment to ask and directly useful right then: it's what lets
  // lib/phone.ts's normalizePhoneE164 parse a bare national number against
  // the RIGHT country instead of always assuming US. Deliberately distinct
  // from the country/region/city columns below, which are best-effort
  // IP-geolocation guesses for aggregate analytics only — this one is a
  // real, user-confirmed fact, not an inference, and (once phone
  // verification isn't the only way to set it) is meant to become the
  // general "this user's country" signal for anything that needs one
  // (e.g. a future locale/language default).
  countryCode: text("country_code"),
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
  // Online-presence visibility (Settings → privacy). Deliberately
  // RECIPROCAL: turning it off both hides this user's own online dot AND
  // stops them seeing anyone else's — no one-way lurking. Presence itself
  // is derived from lastSeenAt (no extra machinery); it only ever surfaces
  // as a per-thread "the other party is online" boolean between people who
  // already share a thread (whisp / Text Whisp), never as any kind of
  // contact list — that would cut against the anonymity model.
  showOnlineStatus: boolean("show_online_status").notNull().default(true),
  // The Whisper Box public-link opt-in (see whisper_box_messages.ts) —
  // deliberately default FALSE and separate from whether the account has a
  // whispererHandle at all. Handles are already assigned automatically the
  // first time someone posts/comments in Debate Now (see
  // lib/whispererHandle.ts) — without this separate flag, everyone active
  // in Debate Now would silently become receivable by strangers the moment
  // they got a handle, with no idea they'd opted into anything. Turning
  // this on is the explicit, only way a public inbound-message page exists
  // for an account.
  whisperBoxEnabled: boolean("whisper_box_enabled").notNull().default(false),
  // A persistent, public, pseudonymous handle (e.g. "SwiftFalcon482") — a
  // deliberate, narrow exception to this app's usual per-thread-only
  // anonymity (see anonymous_handles.ts's schema comment for that default):
  // it's the ONE identity that's meant to persist and be recognizable
  // across Debate Topics, so a topic byline means something and "follow
  // this person" (follows.ts) has something stable to point at. Lazily
  // assigned (lib/whispererHandle.ts) the first time a user needs one —
  // posting a topic, or commenting while signed in — never for a purely
  // anonymous, never-signed-in visitor, who has no account to attach a
  // persistent identity to and so can't be followed. Still not a real
  // name: same random-word-plus-number generator as the per-thread
  // handles, just uniquely scoped globally instead of per-thread. A user
  // can rename their own.
  whispererHandle: text("whisperer_handle").unique(),
  // A preset avatar id from lib/avatars.ts's curated library — assigned
  // randomly the moment whispererHandle itself is (same write). Explicitly
  // separate from avatarUrl above (this account's REAL Clerk profile
  // photo, shown in the authenticated app's own account menu/Settings):
  // that photo must never appear anywhere near the anonymous Debate Topics
  // identity, so this is its own column, its own small closed set of
  // options, and no file upload path at all — a user can only ever pick
  // from the library or explicitly choose none. Null means "no avatar" —
  // a deliberate choice (falls back to the handle's first letter), not
  // "not yet assigned"; assignment always sets a real value up front.
  whispererAvatarId: text("whisperer_avatar_id"),
  // A SEPARATE persistent public handle, only ever used for the Whisper Box
  // URL (/whisper-box/:handle) — deliberately not the same value as
  // whispererHandle above. Debate Now's handle must stay a random,
  // non-identifying word-pair so people can argue anonymously; Whisper Box
  // is the opposite case — it's shared knowingly on a real bio link, so a
  // friend recognizing it is the whole point. Derived from the account's
  // fullName ("display name") when one is set (lib/whispererHandle.ts's
  // assignWhisperBoxHandle slugifies it, e.g. "Jane Doe" -> "JaneDoe" or
  // "JaneDoe482" on a collision); falls back to the same random
  // adjective-noun-digits generator as whispererHandle when no display name
  // is available yet, so the feature still works before that's captured.
  // Assigned once at first enable and left stable across future enable/
  // disable toggles — changing it would 404 any link the user already
  // shared, so it's only ever regenerated through the explicit
  // POST /whisper-box/refresh-handle flow (prompted when a user without a
  // display name goes to copy their link), never silently.
  whisperBoxHandle: text("whisper_box_handle").unique(),
  // ISO 639-1 code (see lib/languages.ts's SUPPORTED_LANGUAGES) — captured
  // once at onboarding (the same one-time gate demographics.ts already
  // enforces before a user's first whisp send, extended to also require
  // this) and editable later in Settings. Unlike gender/ageRange, which are
  // optional-to-decline analytics, this one isn't skippable: it's what the
  // whole app actually renders in (routes' notification/email text, and the
  // frontend's i18next locale), so a real value is required, never
  // "prefer_not_to_say". Null only before a user has ever completed
  // onboarding.
  preferredLanguage: text("preferred_language"),
  // When this account last dismissed ("skip for now") the two-factor-
  // authentication setup nudge — persisted (not just client-side) so a
  // skip made on one device doesn't nag again on another. Whether 2FA is
  // actually ENABLED is never duplicated here: that lives in Clerk itself
  // (user.twoFactorEnabled, read client-side) and is the single source of
  // truth — this column only ever answers "did they say not now."
  mfaNudgeDismissedAt: timestamp("mfa_nudge_dismissed_at", { withTimezone: true }),
  // Best-effort mirror of Clerk's own user.twoFactorEnabled — the single
  // source of truth stays Clerk (see mfaNudgeDismissedAt's comment); this
  // column exists ONLY so the admin compliance view can see who has 2FA on
  // without an API call per row. Null = never synced yet. Refreshed
  // opportunistically in ensureUser.ts on a daily-per-user throttle, so it
  // can lag reality by up to a day — acceptable for a dashboard signal, not
  // used for any access-control decision.
  twoFactorEnabled: boolean("two_factor_enabled"),
  // Admin-facing notification preferences (lib/adminNotify.ts). Stored on
  // every row rather than only admin ones — simpler than a separate
  // preferences table for two booleans — but only ever consulted for a row
  // whose role is currently 'admin'; a regular user's value is inert. Each
  // is independently toggleable (Settings' "Admin notifications" card,
  // shown only to admins) so one alert type can be turned off without
  // silencing the other. Opt-out, on by default: a newly-promoted admin
  // (bootstrap or collaborator grant) starts seeing both rather than
  // silently missing them until they discover the toggle.
  notifyOnNewSignup: boolean("notify_on_new_signup").notNull().default(true),
  notifyOnNewDebateTopic: boolean("notify_on_new_debate_topic").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertUserSchema = createInsertSchema(usersTable).omit({ createdAt: true });
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;
