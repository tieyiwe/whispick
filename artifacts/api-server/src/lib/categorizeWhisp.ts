import { db, whispCategoriesTable, whispsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
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
