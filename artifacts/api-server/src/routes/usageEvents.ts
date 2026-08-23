import { Router, type IRouter } from "express";
import { db, featureEventsTable, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { getAuth } from "@clerk/express";
import { randomUUID } from "crypto";
import { z } from "zod";

const router: IRouter = Router();

// Feature keys are normalized data-testid values (lib/featureUsage.ts) —
// nothing here should ever look like free text or an id. The regex is the
// backstop against a buggy/malicious client stuffing arbitrary strings
// into the analytics table.
const FEATURE_KEY_REGEX = /^[a-z0-9*][a-z0-9*_.:-]{0,99}$/;

const recordUsageSchema = z.object({
  events: z
    .array(
      z.object({
        feature: z.string().regex(FEATURE_KEY_REGEX),
        count: z.number().int().min(1).max(500),
      }),
    )
    .min(1)
    .max(50),
});

// POST /api/public/usage-events — the capture sink. Public on purpose
// (guest browsing of Debate Now/Circle/landing matters just as much for
// trimming clutter as signed-in usage), inheriting the /public rate
// limiter; a signed-in caller's events are attributed to their account so
// stats can tell broad adoption from one power user. Fire-and-forget from
// the client's perspective: it never blocks UI on this.
router.post("/usage-events", async (req, res): Promise<void> => {
  const parsed = recordUsageSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid usage payload" });
    return;
  }

  // Optional identity: resolve the internal user id only when a session is
  // present. Never calls ensureUser (no reason for an analytics ping to
  // create accounts or touch lastSeen — real API traffic does that).
  let userId: string | null = null;
  const { userId: clerkId } = getAuth(req);
  if (clerkId) {
    const user = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.clerkId, clerkId)).then((r) => r[0]);
    userId = user?.id ?? null;
  }

  await db.insert(featureEventsTable).values(
    parsed.data.events.map((e) => ({
      id: randomUUID(),
      feature: e.feature,
      userId,
      count: e.count,
    })),
  );

  res.status(204).send();
});

export default router;
