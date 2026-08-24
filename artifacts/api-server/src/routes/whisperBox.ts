import { Router, type IRouter } from "express";
import { getAuth } from "@clerk/express";
import { db, whisperBoxMessagesTable, usersTable } from "@workspace/db";
import { eq, and, isNull, desc, count } from "drizzle-orm";
import { randomUUID } from "crypto";
import { z } from "zod";
import { requireAuth } from "../lib/auth";
import { ensureUser } from "../lib/ensureUser";
import {
  assignOrGetWhispererIdentity,
  userIdForWhisperBoxHandle,
  assignOrGetWhisperBoxHandle,
  assignWhisperBoxHandle,
  userIdForWhispererHandle,
} from "../lib/whispererHandle";
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

// Resolves a Whisper Box handle to its (enabled) owner's userId. Tries the
// dedicated whisperBoxHandle column first; if that misses, falls back to
// the OLD resolution (whispererHandle) for links shared before that column
// existed, and — only when the account is still whisperBoxEnabled and has
// no whisperBoxHandle of its own yet — lazily migrates it onto one built
// from that same legacy value, so an already-shared link keeps resolving to
// the exact same URL rather than 404ing the moment this shipped. A one-time
// self-heal, not a standing dual-lookup: once migrated, the fallback branch
// is never hit again for that account.
export async function resolveWhisperBoxOwner(handle: string): Promise<{ userId: string; whisperBoxEnabled: boolean } | null> {
  const userId = await userIdForWhisperBoxHandle(handle);
  if (userId) {
    const account = await db.select({ whisperBoxEnabled: usersTable.whisperBoxEnabled }).from(usersTable).where(eq(usersTable.id, userId)).then((r) => r[0]);
    return account ? { userId, whisperBoxEnabled: account.whisperBoxEnabled } : null;
  }

  const legacyUserId = await userIdForWhispererHandle(handle);
  if (!legacyUserId) return null;
  const legacy = await db
    .select({ whisperBoxEnabled: usersTable.whisperBoxEnabled, whisperBoxHandle: usersTable.whisperBoxHandle, whispererHandle: usersTable.whispererHandle })
    .from(usersTable)
    .where(eq(usersTable.id, legacyUserId))
    .then((r) => r[0]);
  if (!legacy || legacy.whisperBoxHandle) return null; // already migrated onto a DIFFERENT handle — this old one is stale, not a match
  if (legacy.whisperBoxEnabled && legacy.whispererHandle === handle) {
    await db.update(usersTable).set({ whisperBoxHandle: legacy.whispererHandle }).where(and(eq(usersTable.id, legacyUserId), isNull(usersTable.whisperBoxHandle)));
  }
  return { userId: legacyUserId, whisperBoxEnabled: legacy.whisperBoxEnabled };
}

// GET /api/public/whisper-box/:handle — resolve a handle to a live Whisper
// Box. Same shape whether the handle doesn't exist or exists but has the
// box turned off, so a bare 404 never distinguishes "no such person" from
// "that person disabled their box."
router.get("/public/whisper-box/:handle", async (req, res): Promise<void> => {
  const owner = await resolveWhisperBoxOwner(req.params.handle);
  if (!owner?.whisperBoxEnabled) {
    res.status(404).json({ error: "This Whisper Box link isn't active." });
    return;
  }
  const account = await db.select({ whispererAvatarId: usersTable.whispererAvatarId }).from(usersTable).where(eq(usersTable.id, owner.userId)).then((r) => r[0]);
  res.json({ handle: req.params.handle, avatarId: account?.whispererAvatarId ?? null });
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
  const owner = await resolveWhisperBoxOwner(req.params.handle);
  if (!owner?.whisperBoxEnabled) {
    res.status(404).json({ error: "This Whisper Box link isn't active." });
    return;
  }
  const userId = owner.userId;

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
// action. Assigns a whisperBoxHandle if the account doesn't have one yet —
// built from the account's display name (fullName) when one is set, so a
// friend can actually recognize it, or the same anonymous-style fallback
// whispererHandle uses when it isn't. Also lazily assigns the SEPARATE
// whispererHandle/avatar (assignOrGetWhispererIdentity) so Debate Now stays
// ready the moment it's needed — that identity must stay non-identifying,
// which is exactly why it's never reused as the Whisper Box handle. One
// call does all of it so Settings only needs one button.
router.post("/whisper-box/enable", requireAuth, async (req, res): Promise<void> => {
  const { userId: clerkId } = getAuth(req);
  const user = await ensureUser(clerkId!, req);
  const debateIdentity = await assignOrGetWhispererIdentity(user.id);
  const whisperBox = await assignOrGetWhisperBoxHandle(user.id, user.fullName);
  await db.update(usersTable).set({ whisperBoxEnabled: true }).where(eq(usersTable.id, user.id));
  res.json({ handle: whisperBox.handle, avatarId: debateIdentity.avatarId, enabled: true });
});

// POST /api/whisper-box/refresh-handle — regenerates the caller's Whisper
// Box handle from their CURRENT display name, overwriting whatever handle
// they have now (including a personalized one — this is a deliberate
// "update my link to match my name" action, not automatic). Only meaningful
// once fullName is actually set: 400s otherwise, since there'd be nothing
// to personalize with. This is the endpoint the frontend calls right after
// capturing a display name from someone who tries to copy their link
// without having set one yet.
router.post("/whisper-box/refresh-handle", requireAuth, async (req, res): Promise<void> => {
  const { userId: clerkId } = getAuth(req);
  const user = await ensureUser(clerkId!, req);
  if (!user.fullName?.trim()) {
    res.status(400).json({ error: "A display name is required to personalize your Whisper Box link." });
    return;
  }
  const whisperBox = await assignWhisperBoxHandle(user.id, user.fullName);
  res.json({ handle: whisperBox.handle });
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
