import { Router } from "express";
import { getAuth } from "@clerk/express";
import { db } from "@workspace/db";
import { usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { requireAuth } from "../lib/auth";
import { ensureUser } from "../lib/ensureUser";

const router = Router();

// GET /api/user/profile
router.get("/profile", requireAuth, async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  const user = await ensureUser(userId!, req);
  res.json({
    id: user.id,
    clerkId: user.clerkId,
    email: user.email,
    fullName: user.fullName,
    avatarUrl: user.avatarUrl,
    plan: user.plan,
    boostCredits: user.boostCredits,
    whisperLinksUsed: user.whisperLinksUsed,
    createdAt: user.createdAt,
  });
});

// PATCH /api/user/profile
router.patch("/profile", requireAuth, async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  const user = await ensureUser(userId!, req);

  const schema = z.object({
    fullName: z.string().nullable().optional(),
    avatarUrl: z.string().nullable().optional(),
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  await db.update(usersTable).set(parsed.data).where(eq(usersTable.id, user.id));
  const updated = await db.select().from(usersTable).where(eq(usersTable.id, user.id)).then(r => r[0]);

  res.json({
    id: updated.id,
    clerkId: updated.clerkId,
    email: updated.email,
    fullName: updated.fullName,
    avatarUrl: updated.avatarUrl,
    plan: updated.plan,
    boostCredits: updated.boostCredits,
    whisperLinksUsed: updated.whisperLinksUsed,
    createdAt: updated.createdAt,
  });
});

export default router;
