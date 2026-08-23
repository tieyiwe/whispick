import Anthropic from "@anthropic-ai/sdk";
import { db, featureEventsTable } from "@workspace/db";
import { sql, gte } from "drizzle-orm";
import { logger } from "./logger";

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
// Same model tier the moderation classifier uses — this is aggregate-number
// analysis, not deep reasoning; fast/cheap is the right trade.
const MODEL = "claude-haiku-4-5-20251001";

let client: Anthropic | null = null;
function getClient(): Anthropic {
  client ??= new Anthropic({ apiKey: ANTHROPIC_API_KEY });
  return client;
}

export type FeatureUsageStat = {
  feature: string;
  totalCount: number;
  distinctUsers: number;
  lastUsedAt: Date | null;
};

// The aggregate behind both the admin stats table and the AI analyzer:
// per-feature totals over a window, how many distinct signed-in users
// touched it, and when it was last used at all.
export async function aggregateFeatureUsage(days: number): Promise<FeatureUsageStat[]> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const rows = await db
    .select({
      feature: featureEventsTable.feature,
      totalCount: sql<number>`sum(${featureEventsTable.count})::int`,
      distinctUsers: sql<number>`count(distinct ${featureEventsTable.userId})::int`,
      lastUsedAt: sql<Date | null>`max(${featureEventsTable.createdAt})`,
    })
    .from(featureEventsTable)
    .where(gte(featureEventsTable.createdAt, since))
    .groupBy(featureEventsTable.feature)
    .orderBy(sql`sum(${featureEventsTable.count}) desc`)
    .limit(500);
  return rows;
}

export type UsageInsight = { title: string; detail: string };

// This is internal analytics over the app's OWN aggregated counters — no
// user content, no untrusted text — so the prompt-hygiene concerns of
// moderation.ts/aiTakeaway.ts don't apply; feature keys are
// regex-constrained slugs. The model is asked for practical product
// decisions, not summaries.
const SYSTEM_PROMPT = `You are a pragmatic product analyst for Blind Whisper, an anonymous messaging app (video "Whisps" sent via private links, short anonymous "Text Whisps" to phone numbers, a public "Blind Circle" video feed, and "Debate Now" anonymous debates).

You receive aggregated feature-usage counters. Feature keys are UI element ids: the prefix tells you the kind (button-, link-, input-, tab-, select-), the rest names the feature; "*" marks a normalized-out record id.

Give sharp, practical insights an owner can act on: what's clearly core (protect it), what's underused relative to its screen real estate (candidates to trim, demote, or redesign), suspicious drop-offs (e.g. a flow's step-2 button used far less than step-1), and one or two concrete experiments. Do not restate the raw numbers back as prose — interpret them. Be honest about low-data situations instead of overclaiming.

Respond with ONLY a JSON array, no other text, of 4-8 objects shaped exactly: {"title": "<short imperative headline>", "detail": "<2-4 sentences of practical reasoning and recommendation>"}`;

export async function generateUsageInsights(days: number): Promise<{ insights: UsageInsight[]; statsAnalyzed: number }> {
  const stats = await aggregateFeatureUsage(days);
  if (!ANTHROPIC_API_KEY) {
    return {
      insights: [{ title: "AI analysis unavailable", detail: "ANTHROPIC_API_KEY isn't configured on the server, so only the raw usage table is available." }],
      statsAnalyzed: stats.length,
    };
  }
  if (stats.length === 0) {
    return {
      insights: [{ title: "No usage data yet", detail: `No feature events were recorded in the last ${days} days. Once the app has been used with tracking deployed, rankings and insights will appear here.` }],
      statsAnalyzed: 0,
    };
  }

  const payload = stats.map((s) => ({ feature: s.feature, total: s.totalCount, users: s.distinctUsers }));
  const response = await getClient().messages.create({
    model: MODEL,
    max_tokens: 1500,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: `Feature usage for the last ${days} days (sorted by total, ${stats.length} features):\n${JSON.stringify(payload)}`,
      },
    ],
  });

  const text = response.content.find((b) => b.type === "text")?.text ?? "";
  try {
    const jsonStart = text.indexOf("[");
    const jsonEnd = text.lastIndexOf("]");
    const parsed = JSON.parse(text.slice(jsonStart, jsonEnd + 1));
    const insights = (Array.isArray(parsed) ? parsed : [])
      .filter((i) => i && typeof i.title === "string" && typeof i.detail === "string")
      .slice(0, 10)
      .map((i) => ({ title: String(i.title).slice(0, 200), detail: String(i.detail).slice(0, 1000) }));
    if (insights.length > 0) return { insights, statsAnalyzed: stats.length };
  } catch (err) {
    logger.warn({ err }, "Usage-insight response wasn't valid JSON; falling back to raw text");
  }
  // Model went off-format — still show the analysis rather than nothing.
  return { insights: [{ title: "Analysis", detail: text.slice(0, 2000) || "The analyzer returned no content." }], statsAnalyzed: stats.length };
}
