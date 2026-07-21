import { db, whispCategoriesTable, whispsTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { randomUUID } from "crypto";
import { fetchTranscript } from "./transcript";
import { categorizeVideo } from "./categorize";
import { logger } from "./logger";

type CategorizableWhisp = {
  id: string;
  videoUrl: string;
  videoTitle: string | null;
  videoPlatform: string | null;
};

// Fire-and-forget after a whisp is created (see routes/whisps.ts) — never on
// the request's critical path, since it involves an external network fetch.
// Re-derives from scratch each call, so it's safe to re-run.
export async function categorizeWhispAsync(whisp: CategorizableWhisp): Promise<void> {
  try {
    const transcript = await fetchTranscript(whisp.videoUrl, whisp.videoPlatform);
    const ranked = categorizeVideo(whisp.videoTitle, transcript);

    await db.delete(whispCategoriesTable).where(eq(whispCategoriesTable.whispId, whisp.id));
    await db.insert(whispCategoriesTable).values(
      ranked.map((r, i) => ({
        id: randomUUID(),
        whispId: whisp.id,
        category: r.category,
        rank: i + 1,
        score: r.score,
      })),
    );

    if (transcript) {
      await db.update(whispsTable).set({ videoTranscript: transcript }).where(eq(whispsTable.id, whisp.id));
    }
  } catch (err) {
    logger.warn({ err, whispId: whisp.id }, "Video categorization failed");
  }
}

// A Group Whisper send creates one whisp row per member for the same single
// video — categorize (and fetch the transcript) once and copy the result
// across every member's row, instead of redoing the same YouTube transcript
// fetch N times for identical content.
export async function categorizeWhispsAsync(whispIds: string[], video: Omit<CategorizableWhisp, "id">): Promise<void> {
  if (!whispIds.length) return;

  try {
    const transcript = await fetchTranscript(video.videoUrl, video.videoPlatform);
    const ranked = categorizeVideo(video.videoTitle, transcript);

    await db.delete(whispCategoriesTable).where(inArray(whispCategoriesTable.whispId, whispIds));
    await db.insert(whispCategoriesTable).values(
      whispIds.flatMap((whispId) =>
        ranked.map((r, i) => ({
          id: randomUUID(),
          whispId,
          category: r.category,
          rank: i + 1,
          score: r.score,
        })),
      ),
    );

    if (transcript) {
      await db.update(whispsTable).set({ videoTranscript: transcript }).where(inArray(whispsTable.id, whispIds));
    }
  } catch (err) {
    logger.warn({ err, whispIds }, "Video categorization failed");
  }
}
