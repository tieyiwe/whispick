import { Router, type IRouter } from "express";
import { z } from "zod";
import type { User } from "@workspace/db";
import { requireAdmin } from "../lib/adminAuth";
import { logAdminAction } from "../lib/adminAudit";
import {
  getOrCreateCircleAgentSettings,
  updateCircleAgentSettings,
  runCircleContentAgentSweep,
  postSingleCircleVideo,
  UnresolvableVideoUrlError,
} from "../lib/circleContentAgent";
import { httpUrlString } from "../lib/safeUrl";

// Admin control surface for the Blind Circle video-discovery posting agent
// ("Circle Scout" in admin UI copy) — config, manual trigger, and manual
// paste-a-link-and-post. Deliberately a separate router/file from
// routes/admin.ts (same reasoning as routes/adminDebateAgent.ts's own
// comment — avoids merge collisions with other admin-agent work) but
// mounted at the same "/admin" base path in routes/index.ts, so its paths
// still read as /api/admin/circle-agent/....
const router: IRouter = Router();

router.use(requireAdmin);

const updateConfigSchema = z.object({
  enabled: z.boolean().optional(),
  dailyPostCount: z.number().int().min(1).max(10).optional(),
  topics: z.array(z.string().trim().min(1).max(60)).min(1).max(20).optional(),
});

// GET /api/admin/circle-agent/config — the singleton settings row, lazily
// created with defaults (disabled, sane bounds) if an admin has never
// touched this feature yet.
router.get("/circle-agent/config", async (_req, res): Promise<void> => {
  const settings = await getOrCreateCircleAgentSettings();
  res.json(settings);
});

// PATCH /api/admin/circle-agent/config — update enabled/dailyPostCount/
// topics. Every change is attributed to the admin who made it and recorded
// in the audit log (before/after) for accountability, same as every other
// admin config change in this app.
router.patch("/circle-agent/config", async (req, res): Promise<void> => {
  const parsed = updateConfigSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const adminUser = (req as any).adminUser as User;
  const before = await getOrCreateCircleAgentSettings();
  const after = await updateCircleAgentSettings(adminUser.id, parsed.data);

  logAdminAction(adminUser.id, "circle_agent.config_update", undefined, { before, after });

  res.json(after);
});

// POST /api/admin/circle-agent/run-now — triggers a discovery sweep
// immediately, regardless of the enabled flag (a manual trigger should work
// even while the feature is paused, e.g. to test config before flipping it
// live) — still respects the missing-ANTHROPIC_API_KEY no-op.
router.post("/circle-agent/run-now", async (req, res): Promise<void> => {
  const adminUser = (req as any).adminUser as User;
  const result = await runCircleContentAgentSweep({ force: true });
  logAdminAction(adminUser.id, "circle_agent.run_now", undefined, result);
  res.json(result);
});

// Not plain .url(): "javascript:alert(1)" passes z.string().url() — the
// http(s)-protocol check httpUrlString does is what actually matters, same
// reasoning as routes/admin.ts's Suggestions Library create route.
const manualPostSchema = z.object({ videoUrl: httpUrlString });

// POST /api/admin/circle-agent/post — an admin manually picks a specific
// video URL to post to the public feed right now, bypassing AI discovery
// entirely. Still resolved through the exact same resolveVideoMeta()
// validation every discovered candidate goes through (postSingleCircleVideo)
// — an admin-picked link isn't exempt from the SSRF/allowlist/private-video
// checks either. A URL that can't be resolved (unsupported host, private/
// restricted content, fetch failure) is rejected with a clear 400 instead
// of inserting a broken post.
router.post("/circle-agent/post", async (req, res): Promise<void> => {
  const parsed = manualPostSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const adminUser = (req as any).adminUser as User;
  try {
    const { id } = await postSingleCircleVideo(parsed.data.videoUrl, "admin_agent");
    logAdminAction(adminUser.id, "circle_agent.manual_post", { type: "whisp", id }, { videoUrl: parsed.data.videoUrl });
    res.status(201).json({ id });
  } catch (err) {
    if (err instanceof UnresolvableVideoUrlError) {
      res.status(400).json({ error: err.message });
      return;
    }
    throw err;
  }
});

export default router;
