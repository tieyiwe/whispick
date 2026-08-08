import { Router } from "express";
import { getAuth } from "@clerk/express";
import { db, invitesTable, notificationsTable, type Invite } from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";
import { randomUUID } from "crypto";
import { z } from "zod";
import { requireAuth } from "../lib/auth";
import { ensureUser } from "../lib/ensureUser";
import { getPublicAppUrl } from "../lib/publicUrl";
import { sendEmail, inviteEmailHtml } from "../lib/email";
import { sendSms, sendWhatsApp, inviteSmsBody } from "../lib/sms";
import { logDeliveryAttempt } from "../lib/deliveryLog";
import { inviteRevealRequestHookLine } from "../lib/copy";
import { inviteLimiter } from "../lib/rateLimit";
import { notifyUser } from "../lib/push";
import { logger } from "../lib/logger";

const router = Router();

const CHANNELS = ["email", "sms", "whatsapp"] as const;

// Dispatches an invite over whichever channel the inviter chose — same
// overall shape as lib/deliver.ts's deliverWhisperLink, but invites aren't
// whisps and never fan out or route to an in-app-matched recipient (a
// recipient who's already a Blind Whisper user doesn't need an invite), so
// this stays local to this file rather than growing deliver.ts to cover a
// second, unrelated kind of send.
//
// Fire-and-forget, called after the create response has already gone out —
// same anti-latency posture every other caller in this app takes with
// real Twilio/Resend round-trips (see deliverWhisperLink's own comment).
async function dispatchInvite(invite: Invite, appUrl: string): Promise<void> {
  const inviteUrl = `${appUrl}/invite/${invite.publicToken}`;
  const logCtx = { whispId: null, purpose: "invite" as const };

  let success: boolean;
  if (invite.channel === "email" && invite.recipientEmail) {
    success = await sendEmail(invite.recipientEmail, "You've been invited to Blind Whisper", inviteEmailHtml(inviteUrl), logCtx);
  } else if (invite.channel === "sms" && invite.recipientPhone) {
    success = await sendSms(invite.recipientPhone, inviteSmsBody(inviteUrl), logCtx);
  } else if (invite.channel === "whatsapp" && invite.recipientPhone) {
    success = await sendWhatsApp(invite.recipientPhone, inviteUrl, logCtx);
  } else {
    logger.error({ inviteId: invite.id, channel: invite.channel }, "No deliverable channel/contact for invite");
    await logDeliveryAttempt((invite.channel as "email" | "sms" | "whatsapp") ?? "email", invite.recipientEmail ?? invite.recipientPhone ?? "unknown", logCtx, {
      success: false,
      errorMessage: "No recipient contact on file for the selected channel",
    });
    success = false;
  }

  if (!success) {
    await db.update(invitesTable).set({ status: "failed" }).where(eq(invitesTable.id, invite.id));
  }
}

// Notifies the invitee in-app that the person who invited them wants to
// reveal themselves. Unlike a whisp's reveal-request notification (which
// re-uses the original email/SMS/WhatsApp channel because the recipient
// never necessarily has an account), an invite reveal is only ever
// meaningful once the invitee has joined — they're a real account holder by
// then, so this goes through the same persistent-notification + live-push
// pair lib/deliver.ts's deliverInApp uses for a matched Ghost Boost
// recipient, pointed at the public invite page so they can accept/decline.
async function notifyInviteeOfReveal(invite: Invite): Promise<void> {
  if (!invite.signedUpUserId) return;
  const title = "Someone wants to reveal themselves";
  const body = inviteRevealRequestHookLine();
  const url = `/invite/${invite.publicToken}`;

  try {
    await db.insert(notificationsTable).values({
      id: randomUUID(),
      targetUserId: invite.signedUpUserId,
      title,
      body,
      url,
      createdByAdminId: null,
    });
    void notifyUser(invite.signedUpUserId, title, body, url);
  } catch (err) {
    logger.error({ err, inviteId: invite.id }, "Failed to notify invitee of reveal request");
  }
}

const createInviteSchema = z
  .object({
    recipientEmail: z.string().nullable().optional(),
    recipientPhone: z.string().nullable().optional(),
    channel: z.enum(CHANNELS),
  })
  .refine((data) => (data.channel === "email" ? !!data.recipientEmail : !!data.recipientPhone), {
    message: "Email invites need a recipient email; text/WhatsApp invites need a recipient phone number",
  });

// POST /api/invites
router.post("/", requireAuth, inviteLimiter, async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  const user = await ensureUser(userId!, req);

  const parsed = createInviteSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { channel, recipientEmail, recipientPhone } = parsed.data;

  const id = randomUUID();
  const publicToken = randomUUID().replace(/-/g, "");

  await db.insert(invitesTable).values({
    id,
    inviterUserId: user.id,
    recipientEmail: channel === "email" ? recipientEmail ?? null : null,
    recipientPhone: channel !== "email" ? recipientPhone ?? null : null,
    channel,
    publicToken,
    status: "sent",
  });

  // Read back and respond before kicking off the fire-and-forget send below
  // — same race-avoidance reasoning as POST /whisps.
  const invite = await db.select().from(invitesTable).where(eq(invitesTable.id, id)).then((r) => r[0]!);
  res.status(201).json(invite);

  void dispatchInvite(invite, getPublicAppUrl(req));
});

// GET /api/invites — the current user's own "invites you've sent" view.
router.get("/", requireAuth, async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  const user = await ensureUser(userId!, req);

  const invites = await db
    .select()
    .from(invitesTable)
    .where(eq(invitesTable.inviterUserId, user.id))
    .orderBy(sql`${invitesTable.createdAt} DESC`);

  res.json(invites);
});

const claimInviteSchema = z.object({ token: z.string().min(1) });

// POST /api/invites/claim — called once by the frontend right after a fresh
// Clerk sign-up that carried a pending invite token through (see
// lib/pendingInvite.ts / ClaimPendingInvite.tsx on the frontend). This is
// the only path that ever sets signedUpUserId/signedUpAt — attribution is
// deliberately push-only (the invitee's own client asserting "I just
// joined via this link"), never inferred server-side from email/phone
// matching, since that would mean quietly linking an account to an invite
// its owner never actually clicked through.
router.post("/claim", requireAuth, async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  const user = await ensureUser(userId!, req);

  const parsed = claimInviteSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const invite = await db.select().from(invitesTable).where(eq(invitesTable.publicToken, parsed.data.token)).then((r) => r[0]);
  if (!invite) {
    res.status(404).json({ error: "Invite not found" });
    return;
  }

  // Idempotent no-op if this invite was already claimed by a different
  // account (a stale/reused sessionStorage token, a double-fire) — the first
  // claim wins, never overwritten.
  if (invite.signedUpUserId && invite.signedUpUserId !== user.id) {
    res.json({ ok: true, alreadyClaimed: true });
    return;
  }

  // An inviter "claiming" their own invite has no product meaning and would
  // corrupt the sent-vs-joined conversion stat — never attributed.
  if (invite.inviterUserId === user.id) {
    res.json({ ok: true, selfInvite: true });
    return;
  }

  if (!invite.signedUpUserId) {
    await db
      .update(invitesTable)
      .set({ signedUpUserId: user.id, signedUpAt: new Date(), status: "joined" })
      .where(eq(invitesTable.id, invite.id));
  }

  res.json({ ok: true });
});

// POST /api/invites/:id/reveal — mirrors routes/whisps.ts's POST /:id/reveal
// as closely as possible (requireAuth, inviter-owned), with one extra gate:
// revealing is only meaningful once the invitee has actually joined
// (signedUpUserId set) — there's no one to notify, and nothing to reveal to,
// before that.
router.post("/:id/reveal", requireAuth, async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  const user = await ensureUser(userId!, req);

  const invite = await db
    .select()
    .from(invitesTable)
    .where(and(eq(invitesTable.id, req.params.id), eq(invitesTable.inviterUserId, user.id)))
    .then((r) => r[0]);

  if (!invite) {
    res.status(404).json({ error: "Invite not found" });
    return;
  }

  if (!invite.signedUpUserId) {
    res.status(400).json({ error: "This invite hasn't been joined yet — you can only reveal yourself once they've signed up." });
    return;
  }

  await db.update(invitesTable).set({ revealRequested: true }).where(eq(invitesTable.id, invite.id));

  const updated = await db.select().from(invitesTable).where(eq(invitesTable.id, invite.id)).then((r) => r[0]);
  res.json(updated);

  // Fire and forget, same posture as whisps' own reveal-request notify:
  // whether this notification goes out shouldn't affect the reveal request
  // itself, already saved and returned above.
  void notifyInviteeOfReveal(invite);
});

// PATCH /api/invites/:id/reveal — called by the (unauthenticated) invitee
// from the public invite page, so the response must stay limited to what
// that page already shows. It must never return the full row: that would
// hand out inviterUserId, recipientEmail/Phone, and everything else to
// anyone who has (or later obtains) this invite id — same discipline as
// PATCH /whisps/:id/reveal.
router.patch("/:id/reveal", async (req, res): Promise<void> => {
  const schema = z.object({ accepted: z.boolean() });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const invite = await db.select().from(invitesTable).where(eq(invitesTable.id, req.params.id)).then((r) => r[0]);

  if (!invite) {
    res.status(404).json({ error: "Invite not found" });
    return;
  }

  if (!invite.revealRequested) {
    res.status(400).json({ error: "No reveal has been requested for this invite" });
    return;
  }

  await db.update(invitesTable).set({ revealAccepted: parsed.data.accepted }).where(eq(invitesTable.id, invite.id));

  res.json({ id: invite.id, revealRequested: true, revealAccepted: parsed.data.accepted });
});

export default router;
