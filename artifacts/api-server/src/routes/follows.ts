import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { followsTable } from "@workspace/db";
import { eq, and, count } from "drizzle-orm";
import { getAuth } from "@clerk/express";
import { randomUUID } from "crypto";
import { z } from "zod";
import { requireAuth } from "../lib/auth";
import { ensureUser } from "../lib/ensureUser";
import { userIdForWhispererHandle } from "../lib/whispererHandle";

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

export default router;
