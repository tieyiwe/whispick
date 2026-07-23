import { Router } from "express";
import { z } from "zod";
import { resolveVideoMeta } from "../lib/videoMeta";

const router = Router();

// POST /api/video/meta
router.post("/meta", async (req, res): Promise<void> => {
  const schema = z.object({ url: z.string().url() });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid URL" });
    return;
  }

  const outcome = await resolveVideoMeta(parsed.data.url);

  switch (outcome.kind) {
    case "invalid_url":
      res.status(400).json({ error: "Only http/https URLs are supported" });
      return;
    case "unsupported":
      res.status(400).json({ error: "Unsupported video URL. Only YouTube, TikTok, Instagram, Facebook, Vimeo, and X/Twitter links are supported." });
      return;
    case "blocked":
      res.status(422).json({ error: outcome.error, code: outcome.code });
      return;
    case "ok":
      res.json({
        title: outcome.title,
        thumbnail: outcome.thumbnail,
        platform: outcome.platform,
        embedUrl: outcome.embedUrl,
        authorName: outcome.authorName,
      });
      return;
  }
});

export default router;
