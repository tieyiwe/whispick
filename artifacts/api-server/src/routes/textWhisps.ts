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
import { createTextWhispLimiter } from "../lib/rateLimit";
import { normalizePhoneE164 } from "../lib/phone";
import { sendSms, textWhispGuestSmsBody } from "../lib/sms";
import { getPublicAppUrl } from "../lib/publicUrl";
import {
  textWhispHookLine,
  textWhispReplyHookLine,
  textWhispRevealRequestHookLine,
  textWhispRevealRespondedHookLine,
} from "../lib/copy";

const router = Router();

// Text Whisps: a short, text-only anonymous message — see
// lib/db/src/schema/text_whisps.ts for the full rationale on why this is its
// own table/route instead of stretching whisps.ts, and for the dual-path
// recipient model (known in-app user vs. any other phone number, delivered
// as a guest link). Every route below is requireAuth-gated EXCEPT the public
// guest-facing view, which lives in routes/publicTextWhisps.ts instead (kept
// as its own file/router, same separation whisps.ts's public surface gets in
// routes/public.ts, rather than mixing authed and unauthenticated routes in
// one file).
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

  const recipientPhone = normalizePhoneE164(parsed.data.recipientPhone);
  if (!recipientPhone) {
    res.status(400).json({ error: "That doesn't look like a valid phone number." });
    return;
  }

  // Every recipient is eligible now — a phone number that doesn't match a
  // known, verified Blind Whisper account just takes the guest-link path
  // below instead of being rejected. The only thing still checked here is
  // "is this the sender's own verified number" (can't send a text whisp to
  // yourself), same self-check as before.
  const matched = await findVerifiedRecipient(recipientPhone);
  if (matched && matched.id === user.id) {
    res.status(400).json({ error: "You can't send a Text Whisp to yourself." });
    return;
  }

  const id = randomUUID();
  const publicToken = randomUUID().replace(/-/g, "");
  await db.insert(textWhispsTable).values({
    id,
    senderId: user.id,
    recipientUserId: matched?.id ?? null,
    recipientPhone,
    publicToken,
    senderAlias: parsed.data.senderAlias ?? null,
    messageText: parsed.data.messageText,
    status: "sent",
  });

  // ANTI-ENUMERATION: read back and respond to the sender BEFORE the
  // fire-and-forget delivery below runs, identical in shape/timing on both
  // the matched (in-app) and unmatched (guest SMS) paths, so the sender's
  // own request can never be used to infer whether recipientPhone was
  // already a Blind Whisper account — same discipline as
  // lib/deliver.ts's deliverWhisperLink (see its own ANTI-ENUMERATION
  // comment) and every other caller of it. Do not await either delivery
  // call above this line, and do not let its result or timing change what's
  // sent back here.
  const textWhisp = await db.select().from(textWhispsTable).where(eq(textWhispsTable.id, id)).then((r) => r[0]);
  res.status(201).json(textWhisp);

  const logCtx = { whispId: null, purpose: "text_whisp" as const };
  if (matched) {
    // Delivered entirely in-app — see lib/deliver.ts's deliverInApp, shared
    // with the matched-whisp path in lib/deliver.ts itself.
    void deliverInApp(matched.id, "You have a new Text Whisp", textWhispHookLine(), `/text-whisps/${id}`, recipientPhone, logCtx);
  } else {
    // Not a known account — deliver a guest link over SMS, same as a
    // whisper_link's unmatched path (lib/deliver.ts's deliverWhisperLink),
    // pointed at the public Text Whisp landing page (routes/publicTextWhisps.ts).
    void sendSms(recipientPhone, textWhispGuestSmsBody(`${getPublicAppUrl(req)}/tw/${publicToken}`), logCtx);
  }

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

  // Notify whichever party didn't just send this reply. Only ever null when
  // the sender follows up on their own Text Whisp before a guest recipient
  // has signed up — there's no in-app account to notify yet in that case
  // (and no other channel: guests can't reply at all, so there's nothing to
  // "notify them of" until they've joined and have a real recipientUserId).
  const notifyUserId = isFromRecipient ? textWhisp.senderId : textWhisp.recipientUserId;
  if (notifyUserId) {
    void deliverInApp(notifyUserId, "New reply on your Text Whisp", textWhispReplyHookLine(), `/text-whisps/${textWhisp.id}`, notifyUserId, {
      whispId: null,
      purpose: "text_whisp_reply",
    });
  }

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

  // Mirrors routes/invites.ts's identical gate: revealing is only
  // meaningful once the recipient is an actual account holder — a guest who
  // only ever saw the public link (routes/publicTextWhisps.ts) has no
  // in-app notification to receive and nothing to accept/decline yet.
  if (!textWhisp.recipientUserId) {
    res.status(400).json({
      error: "This Text Whisp hasn't been opened by a registered recipient yet — you can only reveal yourself once they've signed up.",
    });
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
