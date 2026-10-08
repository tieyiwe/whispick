import { Router, type IRouter } from "express";
import { db, visitorSessionsTable } from "@workspace/db";
import { and, count, desc, gte, isNotNull, sql } from "drizzle-orm";
import { requireAdmin, requirePermission } from "../lib/adminAuth";
import { VISITOR_ONLINE_WINDOW_MS } from "../lib/visitorTracking";

const router: IRouter = Router();

// Own distinct prefix ("/admin/visitors", mounted in routes/index.ts) — same
// reasoning as adminBugRabbit.ts's own comment on why an unscoped
// router.use(requireAdmin) is safe here: this middleware only ever runs for
// requests that already matched this prefix. Gated on the existing
// "analytics" permission rather than a new one — this is analytics, same
// area as /admin/analytics/traffic-by-hour and /admin/users/online-now.
router.use(requireAdmin);
router.use(requirePermission("analytics"));

function onlineSince() {
  return gte(visitorSessionsTable.lastPingAt, new Date(Date.now() - VISITOR_ONLINE_WINDOW_MS));
}

// GET /api/admin/visitors/online — a bare count, meant to be polled far
// more often than the fuller list below (the frontend polls this ~1s). A
// single indexed range-scan COUNT is cheap enough for that cadence; the
// list endpoint below is not, and stays on a slower poll.
router.get("/online", async (_req, res): Promise<void> => {
  const [{ count: onlineCount } = { count: 0 }] = await db
    .select({ count: count() })
    .from(visitorSessionsTable)
    .where(onlineSince());
  res.json({ onlineCount, windowSeconds: VISITOR_ONLINE_WINDOW_MS / 1000 });
});

// GET /api/admin/visitors — the fuller live roster: per-country and
// per-device breakdowns of everyone currently online, plus the most recent
// individual sessions for a live feed. Two aggregate GROUP BYs and one
// LIMITed list, all still constrained to the same online window/index — not
// cheap enough for a ~1s poll like /online above, so the frontend polls
// this on a slower cadence (5-10s).
router.get("/", async (_req, res): Promise<void> => {
  const [byCountry, byDevice, recent] = await Promise.all([
    db
      .select({ country: visitorSessionsTable.country, count: count() })
      .from(visitorSessionsTable)
      .where(and(onlineSince(), isNotNull(visitorSessionsTable.country)))
      .groupBy(visitorSessionsTable.country)
      .orderBy(desc(count())),
    db
      .select({ deviceType: visitorSessionsTable.deviceType, count: count() })
      .from(visitorSessionsTable)
      .where(onlineSince())
      .groupBy(visitorSessionsTable.deviceType)
      .orderBy(desc(count())),
    db
      .select({
        country: visitorSessionsTable.country,
        deviceType: visitorSessionsTable.deviceType,
        isSignedIn: sql<boolean>`${visitorSessionsTable.userId} is not null`,
        lastPingAt: visitorSessionsTable.lastPingAt,
      })
      .from(visitorSessionsTable)
      .where(onlineSince())
      .orderBy(desc(visitorSessionsTable.lastPingAt))
      .limit(50),
  ]);

  res.json({
    byCountry: byCountry.map((r) => ({ country: r.country ?? "Unknown", count: r.count })),
    byDevice: byDevice.map((r) => ({ deviceType: r.deviceType, count: r.count })),
    recent,
    windowSeconds: VISITOR_ONLINE_WINDOW_MS / 1000,
  });
});

export default router;
