import { Router, type IRouter } from "express";
import { db, usersTable, visitorSessionsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { getAuth } from "@clerk/express";
import { z } from "zod";
import { requestIp } from "../lib/ensureUser";
import { classifyDevice } from "../lib/deviceType";
import { cachedCountryForIp, sessionKeyFor } from "../lib/visitorTracking";
import { logger } from "../lib/logger";

const router: IRouter = Router();

const pingSchema = z.object({
  // Only meaningful when signed out — see AppLayout.tsx/lib/anonymousVisitor.ts.
  // A signed-in ping ignores this even if the client sends it (userId wins).
  visitorId: z.string().min(1).max(100).optional(),
});

// POST /api/public/visitor-ping — a periodic heartbeat from every open tab,
// signed-in or not (see lib/visitorPing.ts on the frontend). Same "public,
// resolve identity only when a session is present" shape as
// routes/usageEvents.ts: never calls ensureUser (an analytics ping has no
// business creating accounts or touching users.lastSeenAt — real API
// traffic already does that). Fire-and-forget from the client's
// perspective, and every failure here is silent by design: a missed ping
// just means this visitor drops out of the live count a little early, not
// a broken feature.
router.post("/visitor-ping", async (req, res): Promise<void> => {
  const parsed = pingSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid ping payload" });
    return;
  }

  let userId: string | null = null;
  const { userId: clerkId } = getAuth(req);
  if (clerkId) {
    const user = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.clerkId, clerkId)).then((r) => r[0]);
    userId = user?.id ?? null;
  }

  // Neither a real account nor a client-generated visitorId — nothing to
  // key a session row on. Happens only for a very first request race
  // (visitorId not minted yet) or a malformed client; just no-op rather
  // than erroring, since this endpoint's failures are meant to be silent.
  const visitorId = userId ? null : (parsed.data.visitorId ?? null);
  if (!userId && !visitorId) {
    res.status(204).send();
    return;
  }

  const ip = requestIp(req);
  const [country, deviceType] = await Promise.all([
    cachedCountryForIp(ip),
    Promise.resolve(classifyDevice(req.headers["user-agent"])),
  ]);

  const id = sessionKeyFor(userId, visitorId);
  try {
    await db
      .insert(visitorSessionsTable)
      .values({ id, userId, visitorId, country, deviceType, lastPingAt: new Date() })
      .onConflictDoUpdate({
        target: visitorSessionsTable.id,
        // country/deviceType refresh too, not just lastPingAt — a visitor's
        // network or device can change mid-session (switching wifi/cellular,
        // a PWA reopened on a different device under the same account) and a
        // stale first-ping value shouldn't stick for the rest of the session.
        set: { country, deviceType, lastPingAt: new Date() },
      });
  } catch (err) {
    // Never 500 a fire-and-forget heartbeat — but DO log it, loudly enough
    // to see in deploy logs. The overwhelmingly common cause of this write
    // failing in a fresh deploy is the visitor_sessions table not existing
    // yet because `pnpm --filter @workspace/db run push` wasn't run against
    // the production database — in which case the live-visitor roster stays
    // empty with nothing else to explain why. Surfacing it here turns a
    // silent "no visitors ever show up" into a one-line answer in the logs.
    logger.warn({ err }, "visitor-ping write failed (is the visitor_sessions table migrated in this environment?)");
  }

  res.status(204).send();
});

export default router;
