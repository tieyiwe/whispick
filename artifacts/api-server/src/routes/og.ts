import { Router, type Response } from "express";
import { and, count, eq } from "drizzle-orm";
import { db, debateTopicsTable, debateTopicCommentsTable } from "@workspace/db";
import { getOgPng, MOOD_GLOW, OG_CARDS, type OgCard } from "../lib/ogImage";
import { resolveWhisperBoxOwner } from "./whisperBox";
import { commentNotRemoved, notRetracted } from "./debateTopics";

const router = Router();

// GET /api/og/:kind.png and /api/og/:kind/:id.png — the generated
// og:image cards behind every link preview (lib/linkPreview.ts builds the
// URLs). Public and unauthenticated by necessity: link-preview bots fetch
// them with no session.
//
// Only PUBLIC things are ever looked up by id (a debate topic, a Whisper Box
// handle its owner shares). Private links — whisps, invites, Text Whisps,
// Circle posts — use fixed cards that carry no token at all, so an image
// URL never becomes a capability leak in a crawler/CDN cache, and this
// endpoint can't be used as an oracle for whether a token exists. Anything
// missing, disabled or retracted gets the default card, never an error
// image or a 404 a crawler might render as a broken preview.

const DAY_S = 24 * 60 * 60;
const HOUR_S = 60 * 60;
// Server-side cache lifetime for cards whose text can change (an answer
// count, a box being switched off); fixed cards never go stale.
const MUTABLE_TTL_MS = 10 * 60 * 1000;
const FOREVER = Number.POSITIVE_INFINITY;

async function sendCard(res: Response, key: string, ttlMs: number, maxAgeS: number, build: () => OgCard): Promise<void> {
  const png = await getOgPng(key, ttlMs, build);
  res
    .set("Content-Type", "image/png")
    .set("Cache-Control", `public, max-age=${maxAgeS}`)
    .send(png);
}

const sendDefault = (res: Response, maxAgeS = DAY_S) => sendCard(res, "default", FOREVER, maxAgeS, OG_CARDS.default);

async function sendDebateCard(res: Response, topicId: string): Promise<void> {
  const topic = await db
    .select({ id: debateTopicsTable.id, topicText: debateTopicsTable.topicText })
    .from(debateTopicsTable)
    .where(and(eq(debateTopicsTable.id, topicId), notRetracted()))
    .then((r) => r[0]);
  // A retracted topic's text must stop showing up, so its fallback is
  // only cached briefly downstream too.
  if (!topic) return sendDefault(res, HOUR_S);

  const [{ n }] = await db
    .select({ n: count() })
    .from(debateTopicCommentsTable)
    .where(and(eq(debateTopicCommentsTable.topicId, topic.id), commentNotRemoved()));
  // Count in the key: a new answer re-renders instead of serving a stale card.
  return sendCard(res, `debate:${topic.id}:${n}`, MUTABLE_TTL_MS, HOUR_S, () => OG_CARDS.debate(topic.topicText, Number(n)));
}

async function sendWhisperBoxCard(res: Response, handle: string): Promise<void> {
  const owner = await resolveWhisperBoxOwner(handle);
  // Unknown and disabled look identical here, same as GET /wb/:handle.
  if (!owner?.whisperBoxEnabled) return sendDefault(res, HOUR_S);
  return sendCard(res, `whisperbox:${handle}`, MUTABLE_TTL_MS, HOUR_S, () => OG_CARDS.whisperbox(handle));
}

router.get("/:kind/:id.png", async (req, res): Promise<void> => {
  const { kind, id } = req.params;
  switch (kind) {
    case "debate":
      return sendDebateCard(res, id);
    case "whisperbox":
      return sendWhisperBoxCard(res, id);
    case "whisp": {
      // The id is a mood (it only tints the glow) — never a token.
      const mood = MOOD_GLOW[id] ? id : "none";
      return sendCard(res, `whisp:${mood}`, FOREVER, DAY_S, () => OG_CARDS.whisp(mood));
    }
    default:
      // Fixed-card kinds ignore any id (see the file comment).
      return sendFixed(res, kind);
  }
});

function sendFixed(res: Response, kind: string): Promise<void> {
  switch (kind) {
    case "whisp":
      return sendCard(res, "whisp:none", FOREVER, DAY_S, () => OG_CARDS.whisp());
    case "textwhisp":
      return sendCard(res, "textwhisp", FOREVER, DAY_S, OG_CARDS.textwhisp);
    case "invite":
      return sendCard(res, "invite", FOREVER, DAY_S, OG_CARDS.invite);
    case "circle":
      return sendCard(res, "circle", FOREVER, DAY_S, OG_CARDS.circle);
    case "debate":
      return sendCard(res, "debate-hub", FOREVER, DAY_S, OG_CARDS.debateHub);
    default:
      return sendDefault(res);
  }
}

router.get("/:kind.png", (req, res) => sendFixed(res, req.params.kind));

export default router;
