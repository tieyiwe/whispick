import { Router } from "express";
import { getAuth } from "@clerk/express";
import { db } from "@workspace/db";
import { usersTable, creditTransactionsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { randomUUID } from "crypto";
import { z } from "zod";

const router = Router();

function requireAuth(req: any, res: any, next: any) {
  const { userId } = getAuth(req);
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}

async function ensureUser(clerkId: string, req: any) {
  let user = await db.select().from(usersTable).where(eq(usersTable.clerkId, clerkId)).then(r => r[0]);
  if (!user) {
    const id = randomUUID();
    const sessionClaims = (req as any).auth?.sessionClaims as Record<string, unknown> ?? {};
    const email = (sessionClaims?.email as string) ?? `${clerkId}@whispick.app`;
    const fullName = (sessionClaims?.name as string) ?? null;
    await db.insert(usersTable).values({
      id,
      clerkId,
      email,
      fullName: fullName ?? null,
      plan: "free",
      boostCredits: 0,
      whisperLinksUsed: 0,
    });
    user = await db.select().from(usersTable).where(eq(usersTable.clerkId, clerkId)).then(r => r[0]);
  }
  return user!;
}

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
