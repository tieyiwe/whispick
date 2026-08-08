import { Router } from "express";
import { getAuth } from "@clerk/express";
import { db, textWhispsTable, textWhispRepliesTable } from "@workspace/db";
import { eq, and, or, isNull, asc, desc } from "drizzle-orm";
import { randomUUID } from "crypto";
import { z } from "zod";
import { requireAuth } from "../lib/auth";
import { ensureUser } from "../lib/ensureUser";
import { findVerifiedRecipient, deliverInApp } from "../lib/deliver";
import { moderateTextWhispAsync } from "../lib/moderation";
import { textWhispRecipientCheckLimiter, createTextWhispLimiter } from "../lib/rateLimit";
import {
  textWhispHookLine,
  textWhispReplyHookLine,
  textWhispRevealRequestHookLine,
  textWhispRevealRespondedHookLine,
} from "../lib/copy";

const router = Router();

// Text Whisps: a short, text-only anonymous message between two known,
// verified Blind Whisper users — see lib/db/src/schema/text_whisps.ts for
// the full rationale on why this is its own table/route instead of
// stretching whisps.ts. Every route below is requireAuth-gated; unlike
// whisps.ts there is no unauthenticated/public surface at all for this
// feature, since both parties always have an account.
const MESSAGE_MAX_LENGTH = 260;

// Sender-initiated soft delete — every sender-facing list/lookup excludes
// these for the sender, same as whisps.ts's excludeDeleted(). Never affects
// the recipient's own view of the same row.
function excludeDeleted() {
  return isNull(textWhispsTable.deletedBySenderAt);
}

async function loadTextWhispForUser(id: string, userId: string) {
  const textWhisp = await db
    .select()
    .from(textWhispsTable)
    .where(and(eq(textWhispsTable.id, id), or(eq(textWhispsTable.senderId, userId), eq(textWhispsTable.recipientUserId, userId))))
    .then((r) => r[0]);

  if (!textWhisp) return null;
  // A soft-deleted text whisp is invisible to the sender who deleted it, but
  // never to the recipient — mirrors whisps.ts's deletedBySenderAt exactly.
  if (textWhisp.senderId === userId && textWhisp.deletedBySenderAt) return null;
  return textWhisp;
}

// POST /api/text-whisps/check-recipient — the privacy-sensitive eligibility
// check: does this phone number belong to a known, OTP-verified Blind
// Whisper user? Answers with ONLY a boolean, nothing else (no user id, no
// name, no other field) — same anti-enumeration posture Signal/WhatsApp use
// for contact discovery. This is an unavoidable trade-off given what the
// feature does (product-accepted — see the task's own framing): the
// response itself reveals "is this number a user," so the mitigation is
// (a) never expose it unauthenticated, (b) return nothing beyond the
// boolean, and (c) rate-limit heavily (see lib/rateLimit.ts's
// textWhispRecipientCheckLimiter and its own comment for the exact number
// and reasoning).
const checkRecipientSchema = z.object({ phone: z.string().min(1) });

router.post("/check-recipient", requireAuth, textWhispRecipientCheckLimiter, async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  const user = await ensureUser(userId!, req);

  const parsed = checkRecipientSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const matched = await findVerifiedRecipient(parsed.data.phone);
  // Can't send a text whisp to yourself — not eligible even though your own
  // number is, of course, verified.
  const eligible = !!matched && matched.id !== user.id;

  res.json({ eligible });
});

// GET /api/text-whisps — the authenticated user's own text whisps, sent and
// received, excluding ones they (as sender) soft-deleted.
router.get("/", requireAuth, async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  const user = await ensureUser(userId!, req);

  const rows = await db
    .select()
    .from(textWhispsTable)
    .where(
      and(
        or(eq(textWhispsTable.senderId, user.id), eq(textWhispsTable.recipientUserId, user.id)),
        // Only excludes a row the CURRENT user sent and deleted — a text
        // whisp this user received (sent by someone else) is never hidden
        // by the sender's own delete, same as whisps.ts.
        or(eq(textWhispsTable.recipientUserId, user.id), excludeDeleted()),
      ),
    )
    .orderBy(desc(textWhispsTable.createdAt));

  res.json(rows);
});

// POST /api/text-whisps
const createTextWhispSchema = z.object({
  recipientPhone: z.string().min(1),
  messageText: z.string().min(1).max(MESSAGE_MAX_LENGTH),
  senderAlias: z.string().nullable().optional(),
});

router.post("/", requireAuth, createTextWhispLimiter, async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  const user = await ensureUser(userId!, req);

  const parsed = createTextWhispSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  // Never trust a client-side check-recipient result alone — re-verify
  // eligibility here, server-side, right before the row is written.
  const matched = await findVerifiedRecipient(parsed.data.recipientPhone);
  if (!matched || matched.id === user.id) {
    res.status(400).json({ error: "That contact isn't available for a Text Whisp. They need to be a verified Blind Whisper user." });
    return;
  }

  const id = randomUUID();
  await db.insert(textWhispsTable).values({
    id,
    senderId: user.id,
    recipientUserId: matched.id,
    senderAlias: parsed.data.senderAlias ?? null,
    messageText: parsed.data.messageText,
    status: "sent",
  });

  const textWhisp = await db.select().from(textWhispsTable).where(eq(textWhispsTable.id, id)).then((r) => r[0]);
  res.status(201).json(textWhisp);

  // Delivered entirely in-app — see lib/deliver.ts's deliverInApp, shared
  // with the matched-whisp path in lib/deliver.ts itself. Fire-and-forget,
  // after the response, same posture as every notification in
  // routes/whisps.ts.
  void deliverInApp(matched.id, "You have a new Text Whisp", textWhispHookLine(), `/text-whisps/${id}`, parsed.data.recipientPhone, {
    whispId: null,
    purpose: "text_whisp",
  });

  // Content-safety pass, same classifier whisps get — see
  // lib/moderation.ts's moderateTextWhispAsync.
  void moderateTextWhispAsync({ textWhispId: id, senderId: user.id, text: parsed.data.messageText });
});

// GET /api/text-whisps/:id — only the sender or recipient can view. Marks
// readAt/status 'read' when the RECIPIENT opens it (never when the sender
// views their own sent message).
router.get("/:id", requireAuth, async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  const user = await ensureUser(userId!, req);

  const textWhisp = await loadTextWhispForUser(req.params.id, user.id);
  if (!textWhisp) {
    res.status(404).json({ error: "Text Whisp not found" });
    return;
  }

  const replies = await db
    .select()
    .from(textWhispRepliesTable)
    .where(eq(textWhispRepliesTable.textWhispId, textWhisp.id))
    .orderBy(asc(textWhispRepliesTable.createdAt));

  if (textWhisp.recipientUserId === user.id && !textWhisp.readAt) {
    await db
      .update(textWhispsTable)
      .set({ readAt: new Date(), status: textWhisp.status === "replied" ? "replied" : "read" })
      .where(eq(textWhispsTable.id, textWhisp.id));
    const refreshed = await db.select().from(textWhispsTable).where(eq(textWhispsTable.id, textWhisp.id)).then((r) => r[0]!);
    res.json({ textWhisp: refreshed, replies });
    return;
  }

  res.json({ textWhisp, replies });
});

// DELETE /api/text-whisps/:id — soft delete, sender only. Same semantics as
// whisps.ts: hides it from the sender's own list/detail views without
// touching the row (or its replies); the recipient's view is unaffected.
router.delete("/:id", requireAuth, async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  const user = await ensureUser(userId!, req);

  const textWhisp = await db
    .select()
    .from(textWhispsTable)
    .where(and(eq(textWhispsTable.id, req.params.id), eq(textWhispsTable.senderId, user.id), excludeDeleted()))
    .then((r) => r[0]);

  if (!textWhisp) {
    res.status(404).json({ error: "Text Whisp not found" });
    return;
  }

  await db.update(textWhispsTable).set({ deletedBySenderAt: new Date() }).where(eq(textWhispsTable.id, textWhisp.id));
  res.status(204).send();
});

// GET /api/text-whisps/:id/replies
router.get("/:id/replies", requireAuth, async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  const user = await ensureUser(userId!, req);

  const textWhisp = await loadTextWhispForUser(req.params.id, user.id);
  if (!textWhisp) {
    res.status(404).json({ error: "Text Whisp not found" });
    return;
  }

  const replies = await db
    .select()
    .from(textWhispRepliesTable)
    .where(eq(textWhispRepliesTable.textWhispId, textWhisp.id))
    .orderBy(asc(textWhispRepliesTable.createdAt));

  res.json(replies);
});

// POST /api/text-whisps/:id/replies — from either party, 260-char limit,
// same as the initial message. senderId is always the real, authenticated
// replier's own id (never client-controlled) — the frontend/other party
// tells sender from recipient by comparing it against the parent row's
// senderId/recipientUserId, no separate boolean needed (see
// text_whisp_replies.ts).
const replyTextWhispSchema = z.object({ replyText: z.string().min(1).max(MESSAGE_MAX_LENGTH) });

router.post("/:id/replies", requireAuth, async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  const user = await ensureUser(userId!, req);

  const textWhisp = await loadTextWhispForUser(req.params.id, user.id);
  if (!textWhisp) {
    res.status(404).json({ error: "Text Whisp not found" });
    return;
  }

  const parsed = replyTextWhispSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const id = randomUUID();
  await db.insert(textWhispRepliesTable).values({
    id,
    textWhispId: textWhisp.id,
    senderId: user.id,
    replyText: parsed.data.replyText,
  });

  const isFromRecipient = user.id === textWhisp.recipientUserId;
  if (isFromRecipient) {
    await db.update(textWhispsTable).set({ status: "replied" }).where(eq(textWhispsTable.id, textWhisp.id));
  }

  const reply = await db.select().from(textWhispRepliesTable).where(eq(textWhispRepliesTable.id, id)).then((r) => r[0]);
  res.status(201).json(reply);

  // Notify whichever party didn't just send this reply.
  const notifyUserId = isFromRecipient ? textWhisp.senderId : textWhisp.recipientUserId;
  void deliverInApp(notifyUserId, "New reply on your Text Whisp", textWhispReplyHookLine(), `/text-whisps/${textWhisp.id}`, notifyUserId, {
    whispId: null,
    purpose: "text_whisp_reply",
  });

  void moderateTextWhispAsync({ textWhispId: textWhisp.id, senderId: user.id, text: parsed.data.replyText });
});

// POST /api/text-whisps/:id/reveal — sender requests. requireAuth-gated to
// the sender specifically, unlike whisps.ts (no unauthenticated recipient
// exists here, so both reveal endpoints can just check the caller's role
// directly instead of trusting an unauthenticated public token).
router.post("/:id/reveal", requireAuth, async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  const user = await ensureUser(userId!, req);

  const textWhisp = await db
    .select()
    .from(textWhispsTable)
    .where(and(eq(textWhispsTable.id, req.params.id), eq(textWhispsTable.senderId, user.id), excludeDeleted()))
    .then((r) => r[0]);

  if (!textWhisp) {
    res.status(404).json({ error: "Text Whisp not found" });
    return;
  }

  await db.update(textWhispsTable).set({ revealRequested: true }).where(eq(textWhispsTable.id, textWhisp.id));
  const updated = await db.select().from(textWhispsTable).where(eq(textWhispsTable.id, textWhisp.id)).then((r) => r[0]);
  res.json(updated);

  void deliverInApp(
    textWhisp.recipientUserId,
    "Reveal request",
    textWhispRevealRequestHookLine(),
    `/text-whisps/${textWhisp.id}`,
    textWhisp.recipientUserId,
    { whispId: null, purpose: "text_whisp_reveal_request" },
  );
});

// POST /api/text-whisps/:id/reveal/respond — recipient accepts/declines.
// Same "grants permission, doesn't itself disclose identity" semantics as
// whisps.ts's PATCH /:id/reveal: accepting only lets the sender know they
// may now say who they are via a follow-up reply — this never surfaces the
// sender's real name/email/etc. anywhere on its own.
const respondRevealSchema = z.object({ accepted: z.boolean() });

router.post("/:id/reveal/respond", requireAuth, async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  const user = await ensureUser(userId!, req);

  const textWhisp = await db
    .select()
    .from(textWhispsTable)
    .where(and(eq(textWhispsTable.id, req.params.id), eq(textWhispsTable.recipientUserId, user.id)))
    .then((r) => r[0]);

  if (!textWhisp) {
    res.status(404).json({ error: "Text Whisp not found" });
    return;
  }

  if (!textWhisp.revealRequested) {
    res.status(400).json({ error: "No reveal has been requested for this Text Whisp" });
    return;
  }

  const parsed = respondRevealSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  await db.update(textWhispsTable).set({ revealAccepted: parsed.data.accepted }).where(eq(textWhispsTable.id, textWhisp.id));
  res.json({ id: textWhisp.id, revealRequested: true, revealAccepted: parsed.data.accepted });

  void deliverInApp(
    textWhisp.senderId,
    "Reveal response",
    textWhispRevealRespondedHookLine(parsed.data.accepted),
    `/text-whisps/${textWhisp.id}`,
    textWhisp.senderId,
    { whispId: null, purpose: "text_whisp_reveal_response" },
  );
});

export default router;
