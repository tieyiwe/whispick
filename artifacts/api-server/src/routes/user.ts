import { Router } from "express";
import { getAuth } from "@clerk/express";
import { db } from "@workspace/db";
import { usersTable, pushSubscriptionsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { randomUUID } from "crypto";
import { z } from "zod";
import { requireAuth } from "../lib/auth";
import { ensureUser } from "../lib/ensureUser";
import { getVapidPublicKey } from "../lib/push";

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
    role: user.role,
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

// GET /api/user/push-public-key
router.get("/push-public-key", requireAuth, (_req, res): void => {
  const publicKey = getVapidPublicKey();
  if (!publicKey) {
    res.status(503).json({ error: "Push notifications are not configured" });
    return;
  }
  res.json({ publicKey });
});

const pushSubscriptionSchema = z.object({
  endpoint: z.string().min(1),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
});

// POST /api/user/push-subscription — register a browser's push subscription
router.post("/push-subscription", requireAuth, async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  const user = await ensureUser(userId!, req);

  const parsed = pushSubscriptionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  await db
    .insert(pushSubscriptionsTable)
    .values({
      id: randomUUID(),
      userId: user.id,
      endpoint: parsed.data.endpoint,
      p256dh: parsed.data.keys.p256dh,
      auth: parsed.data.keys.auth,
    })
    .onConflictDoUpdate({
      target: pushSubscriptionsTable.endpoint,
      set: { userId: user.id, p256dh: parsed.data.keys.p256dh, auth: parsed.data.keys.auth },
    });

  res.status(201).json({ ok: true });
});

// DELETE /api/user/push-subscription — unsubscribe this browser
router.delete("/push-subscription", requireAuth, async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  const user = await ensureUser(userId!, req);

  const parsed = z.object({ endpoint: z.string().min(1) }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  await db
    .delete(pushSubscriptionsTable)
    .where(and(eq(pushSubscriptionsTable.userId, user.id), eq(pushSubscriptionsTable.endpoint, parsed.data.endpoint)));

  res.status(204).send();
});

export default router;
