import { Router, type IRouter } from "express";
import { z } from "zod";
import type { User } from "@workspace/db";
import { requireAdmin, requirePermission } from "../lib/adminAuth";
import { logAdminAction } from "../lib/adminAudit";
import {
  getOrCreateDebateAgentSettings,
  updateDebateAgentSettings,
  runDebateTopicAgentSweep,
  postSingleDebateTopic,
} from "../lib/debateAgent";
import { MAX_TOPIC_TEXT_LENGTH } from "./debateTopics";

// Admin control surface for the Debate Topic posting agent ("Town Crier" in
// admin UI copy) — config, manual trigger, and manual compose-and-publish.
// Deliberately a separate router/file from routes/admin.ts (rather than
// appended to that already-large file) to avoid merge collisions with other
// admin-agent work landing around the same time; mounted at the same
// "/admin" base path in routes/index.ts, so its paths still read as
// /api/admin/debate-agent/....
const router: IRouter = Router();

// Scoped to this router's own prefix — an unscoped use() would also run
// for every other /admin/* request that falls through this router on its
// way to a later one, wrongly imposing the "agents" permission on
// unrelated areas.
router.use("/debate-agent", requireAdmin);
router.use("/debate-agent", requirePermission("agents"));

const updateConfigSchema = z.object({
  enabled: z.boolean().optional(),
  dailyPostCount: z.number().int().min(1).max(10).optional(),
  topics: z.array(z.string().trim().min(1).max(60)).min(1).max(20).optional(),
});

// GET /api/admin/debate-agent/config — the singleton settings row, lazily
// created with defaults (disabled, sane bounds) if an admin has never
// touched this feature yet.
router.get("/debate-agent/config", async (_req, res): Promise<void> => {
  const settings = await getOrCreateDebateAgentSettings();
  res.json(settings);
});

// PATCH /api/admin/debate-agent/config — update enabled/dailyPostCount/
// topics. Every change is attributed to the admin who made it and recorded
// in the audit log (before/after) for accountability, same as every other
// admin config change in this app.
router.patch("/debate-agent/config", async (req, res): Promise<void> => {
  const parsed = updateConfigSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const adminUser = (req as any).adminUser as User;
  const before = await getOrCreateDebateAgentSettings();
  const after = await updateDebateAgentSettings(adminUser.id, parsed.data);

  logAdminAction(adminUser.id, "debate_agent.config_update", undefined, { before, after });

  res.json(after);
});

// POST /api/admin/debate-agent/run-now — triggers a sweep immediately,
// regardless of the enabled flag (a manual trigger should work even while
// the feature is paused, e.g. to test config before flipping it live) —
// still respects the missing-ANTHROPIC_API_KEY no-op.
router.post("/debate-agent/run-now", async (req, res): Promise<void> => {
  const adminUser = (req as any).adminUser as User;
  const result = await runDebateTopicAgentSweep({ force: true });
  logAdminAction(adminUser.id, "debate_agent.run_now", undefined, result);
  res.json(result);
});

const manualPostSchema = z.object({ topicText: z.string().trim().min(1).max(MAX_TOPIC_TEXT_LENGTH) });

// POST /api/admin/debate-agent/post — an admin manually composes and
// publishes a single debate topic. Still goes through the same character
// cap and the same content-moderation pass every other write path to
// debate_topics does (postSingleDebateTopic) — an admin's own typed topic
// isn't exempt from safety review.
router.post("/debate-agent/post", async (req, res): Promise<void> => {
  const parsed = manualPostSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const adminUser = (req as any).adminUser as User;
  const { id } = await postSingleDebateTopic(parsed.data.topicText, "admin");
  logAdminAction(adminUser.id, "debate_agent.manual_post", { type: "debate_topic", id }, { topicText: parsed.data.topicText });

  res.status(201).json({ id });
});

export default router;
