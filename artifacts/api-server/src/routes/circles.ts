import { Router } from "express";
import { getAuth } from "@clerk/express";
import { db } from "@workspace/db";
import { circlesTable, circleMembersTable, whispsTable } from "@workspace/db";
import { eq, and, desc, lt, isNull } from "drizzle-orm";
import { randomUUID } from "crypto";
import { z } from "zod";
import { requireAuth } from "../lib/auth";
import { ensureUser } from "../lib/ensureUser";
import { CIRCLE_FEED_COLUMNS, PAGE_SIZE } from "./circle";

const router = Router();

function generateInviteCode(): string {
  return randomUUID().replace(/-/g, "").slice(0, 10);
}

async function requireMembership(circleId: string, userId: string) {
  return db
    .select()
    .from(circleMembersTable)
    .where(and(eq(circleMembersTable.circleId, circleId), eq(circleMembersTable.userId, userId)))
    .then((r) => r[0]);
}

// GET /api/circles — circles the current user belongs to
router.get("/", requireAuth, async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  const user = await ensureUser(userId!, req);

  const memberships = await db
    .select({ circle: circlesTable })
    .from(circleMembersTable)
    .innerJoin(circlesTable, eq(circleMembersTable.circleId, circlesTable.id))
    .where(eq(circleMembersTable.userId, user.id))
    .orderBy(desc(circlesTable.createdAt));

  res.json(memberships.map((m) => m.circle));
});

// POST /api/circles — create a circle (creator becomes the first member)
router.post("/", requireAuth, async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  const user = await ensureUser(userId!, req);

  const parsed = z.object({ name: z.string().min(1).max(60) }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const id = randomUUID();
  await db.insert(circlesTable).values({
    id,
    name: parsed.data.name,
    ownerId: user.id,
    inviteCode: generateInviteCode(),
  });
  await db.insert(circleMembersTable).values({ id: randomUUID(), circleId: id, userId: user.id });

  const circle = await db.select().from(circlesTable).where(eq(circlesTable.id, id)).then((r) => r[0]);
  res.status(201).json(circle);
});

// POST /api/circles/join — join a circle by invite code
router.post("/join", requireAuth, async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  const user = await ensureUser(userId!, req);

  const parsed = z.object({ inviteCode: z.string().min(1) }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const circle = await db
    .select()
    .from(circlesTable)
    .where(eq(circlesTable.inviteCode, parsed.data.inviteCode))
    .then((r) => r[0]);

  if (!circle) {
    res.status(404).json({ error: "Invalid invite code" });
    return;
  }

  const existing = await requireMembership(circle.id, user.id);
  if (!existing) {
    await db.insert(circleMembersTable).values({ id: randomUUID(), circleId: circle.id, userId: user.id });
  }

  res.json(circle);
});

// GET /api/circles/:id/feed — feed of whisps dropped into this circle (members only)
router.get("/:id/feed", requireAuth, async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  const user = await ensureUser(userId!, req);

  const membership = await requireMembership(req.params.id, user.id);
  if (!membership) {
    res.status(403).json({ error: "You're not a member of this circle" });
    return;
  }

  const cursor = typeof req.query.cursor === "string" ? req.query.cursor : undefined;
  let cursorDate: Date | undefined;
  if (cursor) {
    const parsedCursor = new Date(cursor);
    if (!Number.isNaN(parsedCursor.getTime())) cursorDate = parsedCursor;
  }

  const baseCondition = and(
    eq(whispsTable.deliveryMethod, "circle_drop"),
    eq(whispsTable.circleId, req.params.id),
    eq(whispsTable.status, "delivered"),
    // Admin takedowns must reach private-circle feeds too, not just the
    // public discovery feed and token pages.
    isNull(whispsTable.removedByAdminAt),
  );

  const whisps = await db
    .select(CIRCLE_FEED_COLUMNS)
    .from(whispsTable)
    .where(cursorDate ? and(baseCondition, lt(whispsTable.createdAt, cursorDate)) : baseCondition)
    .orderBy(desc(whispsTable.createdAt))
    .limit(PAGE_SIZE);

  const nextCursor = whisps.length === PAGE_SIZE ? whisps[whisps.length - 1]!.createdAt.toISOString() : null;

  res.json({ items: whisps, nextCursor });
});

export default router;
