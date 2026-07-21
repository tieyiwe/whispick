import Anthropic from "@anthropic-ai/sdk";
import { logger } from "./logger";

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
// Same cheap/fast tier as lib/aiTakeaway.ts — a note suggestion is a single
// short sentence, not a task that benefits from a smarter (and far more
// expensive) model.
const MODEL = "claude-haiku-4-5-20251001";
const MAX_NOTE_LENGTH = 200; // must match anonymousNote's column/UI cap

let client: Anthropic | null = null;
function getClient(): Anthropic {
  client ??= new Anthropic({ apiKey: ANTHROPIC_API_KEY });
  return client;
}

// videoTitle/moodTag both come straight from the sender's own composer
// inputs before anything is persisted — no untrusted scraped content here
// (unlike lib/aiTakeaway.ts's transcript), so no injection-hardening needed
// beyond the usual "don't blindly trust user input" hygiene.
const SYSTEM_PROMPT = `You help someone write a short anonymous note to attach to a video they're sending a friend, so the friend has context before pressing play.

Write exactly 3 different short note options, one per line, no numbering, no bullets, no quotation marks, no extra commentary before or after. Each note must be under ${MAX_NOTE_LENGTH} characters, written in first person as if from the sender, warm and genuine rather than generic. Vary the tone across the 3 (e.g. gentle, direct, playful) rather than writing near-duplicates.`;

export async function generateNoteSuggestions(
  videoTitle: string | null,
  moodTag: string | null,
): Promise<string[]> {
  if (!ANTHROPIC_API_KEY) {
    logger.warn("ANTHROPIC_API_KEY not set; skipping note suggestions");
    return [];
  }

  const context = [
    videoTitle ? `Video title: ${videoTitle}` : null,
    moodTag ? `Mood tag chosen for this send: ${moodTag}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const response = await getClient().messages.create({
      model: MODEL,
      max_tokens: 300,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: context || "No video title or mood was provided — write general-purpose notes for sending someone a video anonymously.",
        },
      ],
    });

    const text = response.content.find((block) => block.type === "text")?.text ?? "";
    return text
      .split("\n")
      .map((line) => line.trim().replace(/^["'\-•\d.)\s]+/, "").replace(/["'\s]+$/, "").trim())
      .filter((line) => line.length > 0 && line.length <= MAX_NOTE_LENGTH)
      .slice(0, 3);
  } catch (err) {
    logger.warn({ err }, "Note suggestion generation failed");
    return [];
  }
}
