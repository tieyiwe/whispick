import { Router } from "express";
import { db, suggestedVideosTable } from "@workspace/db";
import { and, desc, eq, sql } from "drizzle-orm";
import { requireAuth } from "../lib/auth";
import { VIDEO_CATEGORIES } from "../lib/categorize";

const router = Router();

// GET /api/suggestions — the user-facing Suggestions Library gallery.
// Requires auth (same posture as Media Library / Whisper Groups) but has
// nothing to do with anonymity — this is admin-curated content, not a
// whisp. Only ever returns status="published": "pending" rows are
// AI-agent finds still awaiting admin review, and must never surface here.
router.get("/", requireAuth, async (req, res): Promise<void> => {
  const categoryFilter = typeof req.query.category === "string" ? req.query.category : undefined;
  const featuredFilter = req.query.featured === "true" ? true : undefined;

  const conditions = [eq(suggestedVideosTable.status, "published")];
  if (categoryFilter) conditions.push(sql`${categoryFilter} = ANY(${suggestedVideosTable.categories})`);
  if (featuredFilter) conditions.push(eq(suggestedVideosTable.featured, true));

  const items = await db
    .select()
    .from(suggestedVideosTable)
    .where(and(...conditions))
    .orderBy(desc(suggestedVideosTable.publishedAt))
    .limit(100);

  res.json({
    items,
    categories: VIDEO_CATEGORIES.map((c) => ({ key: c.key, label: c.label })),
  });
});

// GET /api/suggestions/:id — a single suggestion, for the "Whisper this"
// nudge flow to load full details (video embed, AI summary) before
// carrying it into the composer via forwardVideo.ts.
router.get("/:id", requireAuth, async (req, res): Promise<void> => {
  const suggestion = await db
    .select()
    .from(suggestedVideosTable)
    .where(and(eq(suggestedVideosTable.id, req.params.id), eq(suggestedVideosTable.status, "published")))
    .then((r) => r[0]);

  if (!suggestion) {
    res.status(404).json({ error: "Suggestion not found" });
    return;
  }

  res.json(suggestion);
});

export default router;
