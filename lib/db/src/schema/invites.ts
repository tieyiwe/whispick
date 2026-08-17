import { pgTable, text, timestamp, boolean, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Anonymous invite-a-friend: an existing user invites someone they know to
// join Blind Whisper itself. Sent through the same channels a whisp uses
// (email/SMS/WhatsApp — see routes/invites.ts, lib/email.ts, lib/sms.ts) and
// deliberately reuses whisps.ts's exact consent-based Reveal Flow shape
// (revealRequested/revealAccepted below) rather than inventing a new
// mechanism — the recipient never learns who invited them unless/until the
// inviter chooses to reveal themselves, same guarantee as everywhere else in
// this app.
export const invitesTable = pgTable("invites", {
  id: text("id").primaryKey(),
  inviterUserId: text("inviter_user_id").notNull(),
  recipientEmail: text("recipient_email"),
  recipientPhone: text("recipient_phone"),
  channel: text("channel").notNull(), // 'email' | 'sms' | 'whatsapp'
  // The invite landing page's link token (routes/publicInvites.ts's
  // GET /public/invites/:token) — same possession-of-token trust model as
  // whisps.publicToken.
  publicToken: text("public_token").unique().notNull(),
  status: text("status").notNull().default("sent"), // 'sent' | 'failed' | 'joined'
  // Set once the recipient actually creates a Blind Whisper account via this
  // invite's link (see POST /invites/claim, called once from the frontend
  // right after a Clerk sign-up that carried a pending invite token through
  // — lib/pendingInvite.ts on the frontend). Null until then. This is the
  // only place an invite is ever linked to a real user id; it's never
  // exposed on the unauthenticated public invite page.
  signedUpUserId: text("signed_up_user_id"),
  signedUpAt: timestamp("signed_up_at", { withTimezone: true }),
  revealRequested: boolean("reveal_requested").notNull().default(false),
  revealAccepted: boolean("reveal_accepted"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  // publicToken already gets an index for free from its unique() constraint
  // above — not duplicated here. This backs the sender's own "invites you've
  // sent" list (GET /invites) and the ownership check on the reveal-request
  // endpoint (POST /invites/:id/reveal).
  index("invites_inviter_user_id_idx").on(table.inviterUserId),
]);

export const insertInviteSchema = createInsertSchema(invitesTable).omit({ createdAt: true });
export type InsertInvite = z.infer<typeof insertInviteSchema>;
export type Invite = typeof invitesTable.$inferSelect;
