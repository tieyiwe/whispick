import { pgTable, text, boolean, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// A "Text Whisp": a short, text-only anonymous message — the user-to-user
// counterpart to a Whisper Link, deliberately NOT stored in whisps.ts.
// whisps.videoUrl is NOT NULL and the rest of that table is built around a
// video being the point of the message; a pure-text note doesn't fit there
// and retrofitting it was ruled out as out of scope.
//
// Dual-path recipient model: a Text Whisp can be sent to ANY phone number,
// not just an existing verified Blind Whisper account (see
// routes/textWhisps.ts's POST /). recipientPhone always holds the
// E.164-normalized number the sender typed, regardless of outcome.
// recipientUserId is set only when that number matched a known,
// OTP-verified account (lib/deliver.ts's findVerifiedRecipient) at send
// time — delivery then goes entirely in-app, same as before. When it
// doesn't match, recipientUserId stays null and delivery goes out over SMS
// (lib/sms.ts's textWhispGuestSmsBody) to a public, unauthenticated landing
// page addressed by `publicToken` (see routes/publicTextWhisps.ts) — the
// same "Whisper Link"-style guest flow whisps.ts already has, just for text.
//
// The one deliberate asymmetry vs. whisps.ts: a guest can VIEW that public
// page, but can never REPLY without creating an account. text_whisp_replies
// records a real senderId (see text_whisp_replies.ts's own comment) — there
// is no anonymous-recipient reply flag to attribute an unauthenticated
// reply to, so the public page only ever offers a sign-up CTA, never a
// working reply box. Once a guest signs up, they become a normal
// recipientUserId-bearing user of any *future* Text Whisp, but a Text Whisp
// already sent to their phone number before they joined keeps
// recipientUserId null forever — it's not retroactively re-linked.
//
// Still fully anonymous to the recipient either way: senderAlias is shown,
// never the real sender identity, unless a Reveal Flow (below) is requested
// and accepted — and even then, mirroring whisps.ts's exact behavior,
// accepting only grants *permission*; it doesn't itself inject the sender's
// real name anywhere (see routes/textWhisps.ts's reveal endpoints). A
// reveal request also can't be made until recipientUserId is set (i.e. the
// guest has joined) — see routes/textWhisps.ts POST /:id/reveal's
// "hasn't joined yet" gate, mirroring routes/invites.ts's identical gate.
export const textWhispsTable = pgTable("text_whisps", {
  id: text("id").primaryKey(),
  senderId: text("sender_id").notNull(),
  // Nullable — see the dual-path comment above. Null means "sent to a phone
  // number that wasn't a verified Blind Whisper account at send time."
  recipientUserId: text("recipient_user_id"),
  // Always the E.164-normalized number provided at send time, whether or not
  // it matched a user — needed for guest SMS delivery and admin visibility
  // (support needs to see *who this was addressed to* even when there's no
  // account to show).
  recipientPhone: text("recipient_phone").notNull(),
  // Random, unguessable token for the public guest landing page URL
  // (`/tw/:publicToken`, see routes/publicTextWhisps.ts) — same style/
  // generation as whisps.publicToken and invites.publicToken
  // (randomUUID().replace(/-/g, "")). Every Text Whisp gets one, even a
  // matched in-app send, so a later admin/support lookup or a future
  // "share the guest view" feature doesn't need a backfill.
  publicToken: text("public_token").notNull().unique(),
  senderAlias: text("sender_alias"),
  // Max 260 chars — enforced by Zod at the route layer (see
  // routes/textWhisps.ts), not just implied by a DB constraint, so a bad
  // request fails fast with a clear error instead of a generic DB error.
  messageText: text("message_text").notNull(),
  status: text("status").notNull().default("sent"), // 'sent' | 'read' | 'replied' | 'scheduled'
  revealRequested: boolean("reveal_requested").notNull().default(false),
  revealAccepted: boolean("reveal_accepted"),
  readAt: timestamp("read_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  // Set only when the sender chose "schedule for later" (routes/textWhisps.ts's
  // POST /) — status is 'scheduled' and delivery (the in-app notify or guest
  // SMS) is held back until lib/textWhispScheduler.ts's dispatcher finds this
  // row due, mirroring whisps.scheduledAt/lib/scheduler.ts exactly. Null for
  // every immediately-sent Text Whisp, same as whisps.scheduledAt.
  scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
  // Soft delete, sender-initiated — exact same semantics as
  // whisps.deletedBySenderAt: hides this text whisp from the sender's own
  // list/detail views without touching the row (or its replies) at all.
  // Admins still see everything for support/abuse-report purposes (see
  // routes/admin.ts, which never filters on this). Doesn't affect the
  // recipient's own view — they keep seeing it as before.
  deletedBySenderAt: timestamp("deleted_by_sender_at", { withTimezone: true }),
  // "Is typing…" — purely ephemeral presence, not conversation history.
  // typingUserId records WHICH of the two parties last pinged (either can);
  // typingAt is when. routes/textWhisps.ts's toResponse() turns this into a
  // single viewer-relative otherPartyTyping boolean (true only while it's
  // both the OTHER party and recent — see its own TYPING_TTL_MS), the same
  // "compute a relative fact server-side, never hand back the raw row" shape
  // viewerIsRecipient already uses. No separate "stopped typing" event: it
  // just ages out after the TTL, and POST /:id/replies also clears it
  // immediately on send so the indicator doesn't linger past the message
  // that made it moot.
  typingUserId: text("typing_user_id"),
  typingAt: timestamp("typing_at", { withTimezone: true }),
  // 'user' (default, the normal person-to-person flow above) | 'admin' — an
  // admin-composed send (routes/adminTextWhisps.ts): a platform broadcast to
  // all/selected users, or one staff member reaching a colleague directly by
  // account instead of by phone number. Both always have a real
  // recipientUserId and are delivered purely in-app — never real SMS, since
  // there's no anonymous-guest phase to this kind of send. senderAlias
  // carries the visible "who this is from" for these (e.g. "Blind Whisper
  // Team"), deliberately NOT anonymous — this is the platform or a named
  // colleague speaking, not a stranger.
  source: text("source").notNull().default("user"),
  // Admin-initiated takedown of a flagged Text Whisp — same reasoning as
  // whisps.removedByAdminAt/whisper_box_messages.removedByAdminAt. Distinct
  // from deletedBySenderAt above: that one only ever hides the message from
  // the SENDER's own list; this hides it from BOTH the recipient's inbox and
  // the public guest landing page (routes/publicTextWhisps.ts), since a
  // moderation takedown needs to actually stop the recipient from seeing
  // flagged content, not just tidy the sender's view. Admins still see
  // everything regardless (routes/admin.ts never filters on this).
  removedByAdminAt: timestamp("removed_by_admin_at", { withTimezone: true }),
}, (table) => [
  index("text_whisps_sender_id_idx").on(table.senderId),
  index("text_whisps_recipient_user_id_idx").on(table.recipientUserId),
  // publicToken already gets an index for free from its unique() constraint
  // — no separate index needed, same as whisps.publicToken/invites.publicToken.
]);

export const insertTextWhispSchema = createInsertSchema(textWhispsTable).omit({ createdAt: true });
export type InsertTextWhisp = z.infer<typeof insertTextWhispSchema>;
export type TextWhisp = typeof textWhispsTable.$inferSelect;
