import { Router, type IRouter } from "express";
import { getAuth } from "@clerk/express";
import { db, whisperBoxMessagesTable, usersTable } from "@workspace/db";
import { eq, and, isNull, desc, count } from "drizzle-orm";
import { randomUUID } from "crypto";
import { z } from "zod";
import { requireAuth } from "../lib/auth";
import { ensureUser } from "../lib/ensureUser";
import { userIdForWhispererHandle, assignOrGetWhispererIdentity } from "../lib/whispererHandle";
import { notifyUserPersisted } from "../lib/push";
import { moderateWhisperBoxMessageAsync } from "../lib/moderation";
import { whisperBoxSendLimiter } from "../lib/rateLimit";

const router: IRouter = Router();

// The Whisper Box — see whisper_box_messages.ts's schema comment for the
// full rationale (this is the app's one deliberately anonymous-SENDER
// surface, meant to be shared on a public bio link). No prefix on this
// router: it defines both its public paths (/public/whisper-box/...) and
// its authenticated ones (/whisper-box/...) itself, same pattern
// debateTopics.ts uses for the same reason (mixing public and authed routes
// in one file, grouped by feature rather than by auth requirement).
const MESSAGE_MAX_LENGTH = 500;

// ---------------------------------------------------------------------------
// Public — no account needed, ever, for these three.
// ---------------------------------------------------------------------------

// GET /api/public/whisper-box/:handle — resolve a handle to a live Whisper
// Box. Same shape whether the handle doesn't exist or exists but has the
// box turned off, so a bare 404 never distinguishes "no such person" from
// "that person disabled their box."
router.get("/public/whisper-box/:handle", async (req, res): Promise<void> => {
  const userId = await userIdForWhispererHandle(req.params.handle);
  if (!userId) {
    res.status(404).json({ error: "This Whisper Box link isn't active." });
    return;
  }
  const account = await db
    .select({ whisperBoxEnabled: usersTable.whisperBoxEnabled, whispererAvatarId: usersTable.whispererAvatarId, whispererHandle: usersTable.whispererHandle })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .then((r) => r[0]);
  if (!account?.whisperBoxEnabled) {
    res.status(404).json({ error: "This Whisper Box link isn't active." });
    return;
  }
  res.json({ handle: account.whispererHandle, avatarId: account.whispererAvatarId });
});

const sendMessageSchema = z.object({
  messageText: z.string().trim().min(1).max(MESSAGE_MAX_LENGTH),
  senderAlias: z.string().trim().max(60).nullable().optional(),
});

// The limiter is registered via router.use on its own path rather than
// inlined as a second argument to router.post below — mixing an extra
// middleware arg into the same route registration widens Express's
// inferred req.params type from string to string | string[], the same
// :id-inference footgun routes/invites.ts's PATCH /:id/reveal works around
// identically. Registered here (AFTER the GET handler above, BEFORE the
// POST handler below) so it only ever applies to the POST: a GET request
// terminates at the earlier GET handler before ever reaching this
// method-agnostic path middleware, same ordering trick invites.ts relies
// on — page loads stay on the shared publicEndpointLimiter budget, only
// the actual send gets the tighter one.
router.use("/public/whisper-box/:handle", whisperBoxSendLimiter);

// POST /api/public/whisper-box/:handle — the send itself. Deliberately
// minimal, constant-shaped response (no id, no confirmation of anything
// about the recipient) — same anti-enumeration/no-feedback posture as
// lib/subscribe.ts's POST /subscribe, since this is another unauthenticated
// endpoint where the response shape must never become an oracle.
router.post("/public/whisper-box/:handle", async (req, res): Promise<void> => {
  const parsed = sendMessageSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const userId = await userIdForWhispererHandle(req.params.handle);
  if (!userId) {
    res.status(404).json({ error: "This Whisper Box link isn't active." });
    return;
  }
  const account = await db.select({ whisperBoxEnabled: usersTable.whisperBoxEnabled }).from(usersTable).where(eq(usersTable.id, userId)).then((r) => r[0]);
  if (!account?.whisperBoxEnabled) {
    res.status(404).json({ error: "This Whisper Box link isn't active." });
    return;
  }

  const id = randomUUID();
  await db.insert(whisperBoxMessagesTable).values({
    id,
    recipientUserId: userId,
    messageText: parsed.data.messageText,
    senderAlias: parsed.data.senderAlias ?? null,
  });

  res.status(201).json({ ok: true });

  void notifyUserPersisted(userId, "You got a Whisper Box message 💌", "Someone sent you an anonymous message.", "/whisper-box", "whisper_box");
  void moderateWhisperBoxMessageAsync({ whisperBoxMessageId: id, text: parsed.data.messageText });
});

// ---------------------------------------------------------------------------
// Authenticated — the recipient's own inbox and settings.
// ---------------------------------------------------------------------------

function excludeRemoved() {
  return isNull(whisperBoxMessagesTable.removedByAdminAt);
}

// POST /api/whisper-box/enable — the Settings "Get your Whisper Box link"
// action. Assigns a whispererHandle if the account doesn't have one yet
// (same lazy-assign as the first Debate Now post/comment), then flips the
// opt-in on. One call does both so Settings only needs one button.
router.post("/whisper-box/enable", requireAuth, async (req, res): Promise<void> => {
  const { userId: clerkId } = getAuth(req);
  const user = await ensureUser(clerkId!, req);
  const identity = await assignOrGetWhispererIdentity(user.id);
  await db.update(usersTable).set({ whisperBoxEnabled: true }).where(eq(usersTable.id, user.id));
  res.json({ handle: identity.handle, avatarId: identity.avatarId, enabled: true });
});

// POST /api/whisper-box/disable — turns the public page off without
// touching the handle itself (still usable for Debate Now / follows).
router.post("/whisper-box/disable", requireAuth, async (req, res): Promise<void> => {
  const { userId: clerkId } = getAuth(req);
  const user = await ensureUser(clerkId!, req);
  await db.update(usersTable).set({ whisperBoxEnabled: false }).where(eq(usersTable.id, user.id));
  res.json({ enabled: false });
});

// GET /api/whisper-box — the caller's own received messages.
router.get("/whisper-box", requireAuth, async (req, res): Promise<void> => {
  const { userId: clerkId } = getAuth(req);
  const user = await ensureUser(clerkId!, req);

  const items = await db
    .select()
    .from(whisperBoxMessagesTable)
    .where(and(eq(whisperBoxMessagesTable.recipientUserId, user.id), excludeRemoved()))
    .orderBy(desc(whisperBoxMessagesTable.createdAt))
    .limit(100);

  res.json({ items });
});

// GET /api/whisper-box/unread-count — a lightweight poll target for a nav
// badge, mirroring GET /user/notifications/unread-count's shape.
router.get("/whisper-box/unread-count", requireAuth, async (req, res): Promise<void> => {
  const { userId: clerkId } = getAuth(req);
  const user = await ensureUser(clerkId!, req);

  const [{ count: unreadCount } = { count: 0 }] = await db
    .select({ count: count() })
    .from(whisperBoxMessagesTable)
    .where(and(eq(whisperBoxMessagesTable.recipientUserId, user.id), eq(whisperBoxMessagesTable.status, "unread"), excludeRemoved()));

  res.json({ unreadCount });
});

// POST /api/whisper-box/:id/read
router.post("/whisper-box/:id/read", requireAuth, async (req, res): Promise<void> => {
  const { userId: clerkId } = getAuth(req);
  const user = await ensureUser(clerkId!, req);

  const message = await db
    .select({ id: whisperBoxMessagesTable.id })
    .from(whisperBoxMessagesTable)
    .where(and(eq(whisperBoxMessagesTable.id, req.params.id), eq(whisperBoxMessagesTable.recipientUserId, user.id)))
    .then((r) => r[0]);
  if (!message) {
    res.status(404).json({ error: "Message not found" });
    return;
  }

  await db
    .update(whisperBoxMessagesTable)
    .set({ status: "read", readAt: new Date() })
    .where(and(eq(whisperBoxMessagesTable.id, message.id), eq(whisperBoxMessagesTable.status, "unread")));
  res.status(204).send();
});

// DELETE /api/whisper-box/:id — the recipient's own inbox, their choice.
// Hard delete is fine here (unlike whisps' soft delete): there's no
// sender-side copy to preserve, since there's no sender account at all.
router.delete("/whisper-box/:id", requireAuth, async (req, res): Promise<void> => {
  const { userId: clerkId } = getAuth(req);
  const user = await ensureUser(clerkId!, req);

  const message = await db
    .select({ id: whisperBoxMessagesTable.id })
    .from(whisperBoxMessagesTable)
    .where(and(eq(whisperBoxMessagesTable.id, req.params.id), eq(whisperBoxMessagesTable.recipientUserId, user.id)))
    .then((r) => r[0]);
  if (!message) {
    res.status(404).json({ error: "Message not found" });
    return;
  }
  await db.delete(whisperBoxMessagesTable).where(eq(whisperBoxMessagesTable.id, message.id));
  res.status(204).send();
});

export default router;
