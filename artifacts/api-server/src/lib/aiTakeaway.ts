import Anthropic from "@anthropic-ai/sdk";
import { db, whispsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { fetchTranscript } from "./transcript";
import { logger } from "./logger";

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = "claude-haiku-4-5-20251001";

let client: Anthropic | null = null;
function getClient(): Anthropic {
  client ??= new Anthropic({ apiKey: ANTHROPIC_API_KEY });
  return client;
}

const SYSTEM_PROMPT = `You are a warm, perceptive therapist. A friend just watched a video someone anonymously sent them because they thought it was something the friend needed to hear right now.

Write a short "takeaway" — 2 to 4 sentences, in second person ("you"), speaking directly to the person who watched it. Don't summarize the video's plot or content point by point; instead name the real emotional or practical thread underneath it — what it's really about, and what it might mean for them right now. Be sharp and specific, never generic or preachy. Warm but not saccharine. No greetings, no sign-off, no headers — just the takeaway itself.`;

interface TakeawaySource {
  id: string;
  videoUrl: string;
  videoTitle: string | null;
  videoPlatform: string | null;
  videoTranscript: string | null;
}

// Fire-and-forget, same posture as categorizeWhispAsync: never on a
// request's critical path, tolerant of every failure mode. Re-fetches the
// whisp's current aiTakeawayStatus first so two near-simultaneous triggers
// (a watched_complete event racing the unwatched-nudge sweep) can't both
// spend an API call on the same whisp.
export async function generateTakeawayAsync(whispId: string): Promise<void> {
  if (!ANTHROPIC_API_KEY) {
    logger.warn({ whispId }, "ANTHROPIC_API_KEY not set; skipping AI takeaway");
    return;
  }

  const whisp = await db.select().from(whispsTable).where(eq(whispsTable.id, whispId)).then((r) => r[0]);
  if (!whisp || whisp.aiTakeawayStatus) return;

  await generateTakeaway(whisp);
}

async function generateTakeaway(whisp: TakeawaySource): Promise<void> {
  try {
    const transcript = whisp.videoTranscript ?? (await fetchTranscript(whisp.videoUrl, whisp.videoPlatform));

    // Transcript-based, so only ever available where we can get one
    // (YouTube today) — this is a hard limitation, not a transient failure,
    // so it's recorded as 'unavailable' rather than left null for retry.
    if (!transcript) {
      await db.update(whispsTable).set({ aiTakeawayStatus: "unavailable" }).where(eq(whispsTable.id, whisp.id));
      return;
    }

    const response = await getClient().messages.create({
      model: MODEL,
      max_tokens: 300,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `Video title: ${whisp.videoTitle ?? "Untitled"}\n\nTranscript:\n${transcript.slice(0, 6000)}`,
        },
      ],
    });

    const text = response.content.find((block) => block.type === "text")?.text?.trim();
    if (!text) {
      await db.update(whispsTable).set({ aiTakeawayStatus: "unavailable" }).where(eq(whispsTable.id, whisp.id));
      return;
    }

    await db
      .update(whispsTable)
      .set({ aiTakeaway: text, aiTakeawayStatus: "ready", aiTakeawayGeneratedAt: new Date() })
      .where(eq(whispsTable.id, whisp.id));
  } catch (err) {
    logger.warn({ err, whispId: whisp.id }, "AI takeaway generation failed");
    await db.update(whispsTable).set({ aiTakeawayStatus: "unavailable" }).where(eq(whispsTable.id, whisp.id));
  }
}
