import { Router } from "express";
import { getAuth } from "@clerk/express";
import { db } from "@workspace/db";
import { usersTable, pushSubscriptionsTable, notificationsTable, notificationReadsTable } from "@workspace/db";
import { eq, and, or, isNull, desc, count, notInArray } from "drizzle-orm";
import { randomUUID } from "crypto";
import { z } from "zod";
import { requireAuth } from "../lib/auth";
import { ensureUser } from "../lib/ensureUser";
import { getVapidPublicKey } from "../lib/push";
import { GENDER_OPTIONS, AGE_RANGE_OPTIONS } from "../lib/demographics";

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
    phone: user.phone,
    gender: user.gender,
    ageRange: user.ageRange,
    plan: user.plan,
    boostCredits: user.boostCredits,
    whisperLinksUsed: user.whisperLinksUsed,
    role: user.role,
    createdAt: user.createdAt,
  });
});

// PATCH /api/user/profile — also how the one-time demographic gate (see
// lib/demographics.ts) saves a user's answer, and how Settings lets them
// change it later; both go through the same fields, same endpoint.
router.patch("/profile", requireAuth, async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  const user = await ensureUser(userId!, req);

  const schema = z.object({
    fullName: z.string().nullable().optional(),
    avatarUrl: z.string().nullable().optional(),
    gender: z.enum(GENDER_OPTIONS).nullable().optional(),
    ageRange: z.enum(AGE_RANGE_OPTIONS).nullable().optional(),
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
    phone: updated.phone,
    gender: updated.gender,
    ageRange: updated.ageRange,
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

// ---------------------------------------------------------------------------
// Notifications — the persistent, in-app counterpart to push (see
// lib/push.ts): a broadcast (targetUserId null) or one addressed to this
// user specifically, most recent first, with per-user read state joined in
// from notificationReadsTable (a broadcast row is shared by everyone, so
// read state can't live on the notification row itself).
// ---------------------------------------------------------------------------

function visibleToUser(userId: string) {
  return or(isNull(notificationsTable.targetUserId), eq(notificationsTable.targetUserId, userId));
}

// GET /api/user/notifications
router.get("/notifications", requireAuth, async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  const user = await ensureUser(userId!, req);

  const rows = await db
    .select({
      id: notificationsTable.id,
      targetUserId: notificationsTable.targetUserId,
      title: notificationsTable.title,
      body: notificationsTable.body,
      url: notificationsTable.url,
      createdByAdminId: notificationsTable.createdByAdminId,
      createdAt: notificationsTable.createdAt,
      readAt: notificationReadsTable.readAt,
    })
    .from(notificationsTable)
    .leftJoin(
      notificationReadsTable,
      and(eq(notificationReadsTable.notificationId, notificationsTable.id), eq(notificationReadsTable.userId, user.id)),
    )
    .where(visibleToUser(user.id))
    .orderBy(desc(notificationsTable.createdAt))
    .limit(50);

  const unreadCount = rows.filter((r) => !r.readAt).length;

  res.json({
    items: rows.map(({ readAt, ...n }) => ({ ...n, read: !!readAt })),
    unreadCount,
  });
});

// GET /api/user/notifications/unread-count — a lightweight poll target for
// a nav badge, without pulling the full list every time.
router.get("/notifications/unread-count", requireAuth, async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  const user = await ensureUser(userId!, req);

  const row = await db
    .select({ count: count() })
    .from(notificationsTable)
    .leftJoin(
      notificationReadsTable,
      and(eq(notificationReadsTable.notificationId, notificationsTable.id), eq(notificationReadsTable.userId, user.id)),
    )
    .where(and(visibleToUser(user.id), isNull(notificationReadsTable.id)))
    .then((r) => r[0]);

  res.json({ unreadCount: row?.count ?? 0 });
});

// POST /api/user/notifications/:id/read
router.post("/notifications/:id/read", requireAuth, async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  const user = await ensureUser(userId!, req);

  const notification = await db
    .select({ id: notificationsTable.id })
    .from(notificationsTable)
    .where(and(eq(notificationsTable.id, req.params.id), visibleToUser(user.id)))
    .then((r) => r[0]);
  if (!notification) {
    res.status(404).json({ error: "Notification not found" });
    return;
  }

  const existing = await db
    .select({ id: notificationReadsTable.id })
    .from(notificationReadsTable)
    .where(and(eq(notificationReadsTable.notificationId, notification.id), eq(notificationReadsTable.userId, user.id)))
    .then((r) => r[0]);

  if (!existing) {
    await db.insert(notificationReadsTable).values({ id: randomUUID(), notificationId: notification.id, userId: user.id });
  }

  res.status(204).send();
});

// POST /api/user/notifications/read-all
router.post("/notifications/read-all", requireAuth, async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  const user = await ensureUser(userId!, req);

  const alreadyRead = await db
    .select({ notificationId: notificationReadsTable.notificationId })
    .from(notificationReadsTable)
    .where(eq(notificationReadsTable.userId, user.id));
  const alreadyReadIds = alreadyRead.map((r) => r.notificationId);

  const unread = await db
    .select({ id: notificationsTable.id })
    .from(notificationsTable)
    .where(
      alreadyReadIds.length
        ? and(visibleToUser(user.id), notInArray(notificationsTable.id, alreadyReadIds))
        : visibleToUser(user.id),
    );

  if (unread.length) {
    await db
      .insert(notificationReadsTable)
      .values(unread.map((n) => ({ id: randomUUID(), notificationId: n.id, userId: user.id })));
  }

  res.status(204).send();
});

export default router;
