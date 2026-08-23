import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { followsTable, usersTable } from "@workspace/db";
import { eq, and, count, inArray } from "drizzle-orm";
import { getAuth } from "@clerk/express";
import { randomUUID } from "crypto";
import { z } from "zod";
import { requireAuth } from "../lib/auth";
import { ensureUser } from "../lib/ensureUser";
import { userIdForWhispererHandle } from "../lib/whispererHandle";
import { presenceFor } from "../lib/presence";

const router: IRouter = Router();

// POST /api/follows — toggle following the account behind a public
// whispererHandle. The handle, not a raw userId, is the only thing the
// client ever sends here (see whispererHandle.ts's userIdForWhispererHandle)
// — same anti-enumeration posture as every other public-facing surface in
// this app.
router.post("/", requireAuth, async (req, res): Promise<void> => {
  const { userId: clerkId } = getAuth(req);
  const viewer = await ensureUser(clerkId!, req);

  const parsed = z.object({ handle: z.string().min(1).max(50) }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const followedUserId = await userIdForWhispererHandle(parsed.data.handle);
  if (!followedUserId) {
    res.status(404).json({ error: "No account with that handle" });
    return;
  }
  if (followedUserId === viewer.id) {
    res.status(400).json({ error: "You can't follow yourself" });
    return;
  }

  const existing = await db
    .select({ id: followsTable.id })
    .from(followsTable)
    .where(and(eq(followsTable.followerUserId, viewer.id), eq(followsTable.followedUserId, followedUserId)))
    .then((r) => r[0]);

  if (existing) {
    await db.delete(followsTable).where(eq(followsTable.id, existing.id));
  } else {
    await db.insert(followsTable).values({ id: randomUUID(), followerUserId: viewer.id, followedUserId });
  }

  const [{ count: followerCount } = { count: 0 }] = await db
    .select({ count: count() })
    .from(followsTable)
    .where(eq(followsTable.followedUserId, followedUserId));

  res.json({ following: !existing, followerCount });
});

// GET /api/follows/stats — the CALLER's own follower/following counts.
router.get("/stats", requireAuth, async (req, res): Promise<void> => {
  const { userId: clerkId } = getAuth(req);
  const viewer = await ensureUser(clerkId!, req);

  const [[{ count: followerCount } = { count: 0 }], [{ count: followingCount } = { count: 0 }]] = await Promise.all([
    db.select({ count: count() }).from(followsTable).where(eq(followsTable.followedUserId, viewer.id)),
    db.select({ count: count() }).from(followsTable).where(eq(followsTable.followerUserId, viewer.id)),
  ]);

  res.json({ followerCount, followingCount });
});

// GET /api/follows/online-status — which followed Whisperer handles are
// online right now (see lib/presence.ts for why this is the ONLY place in
// the app that surfaces presence at all — everywhere else is an anonymous
// thread where doing this would be a real deanonymization risk). Empty
// immediately if the viewer has their own visibility off, since that's the
// same "you can't see anyone if you're invisible" rule presenceFor enforces
// per-pair — no point paying for the query.
router.get("/online-status", requireAuth, async (req, res): Promise<void> => {
  const { userId: clerkId } = getAuth(req);
  const viewer = await ensureUser(clerkId!, req);

  if (!viewer.showOnlineStatus) {
    res.json({ online: {} });
    return;
  }

  const followed = await db.select({ followedUserId: followsTable.followedUserId }).from(followsTable).where(eq(followsTable.followerUserId, viewer.id));
  const followedIds = followed.map((f) => f.followedUserId);
  if (!followedIds.length) {
    res.json({ online: {} });
    return;
  }

  const accounts = await db
    .select({ whispererHandle: usersTable.whispererHandle, showOnlineStatus: usersTable.showOnlineStatus, lastSeenAt: usersTable.lastSeenAt })
    .from(usersTable)
    .where(inArray(usersTable.id, followedIds));

  const online: Record<string, boolean> = {};
  for (const account of accounts) {
    if (!account.whispererHandle) continue; // hasn't posted/commented yet — nothing to key the map by
    const result = presenceFor(viewer, account);
    if (result !== null) online[account.whispererHandle] = result;
  }

  res.json({ online });
});

export default router;
