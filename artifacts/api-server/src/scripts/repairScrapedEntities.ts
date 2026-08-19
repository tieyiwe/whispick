/**
 * One-shot repair for whisps and replies scraped before og: values were
 * HTML-decoded.
 *
 * The scrape now decodes entities (lib/videoMeta.ts decodeHtmlEntities), but
 * rows written before that still hold the raw attribute text. For a title
 * that's cosmetic — "15M views &#xb7; 299K reactions". For a thumbnail it is
 * not: Facebook's CDN URLs are signed across several query parameters, and
 * with `&amp;` still in place the signature is malformed, so the image 403s
 * and every affected preview renders broken. Those rows can't fix themselves,
 * because nothing re-scrapes an already-sent whisp.
 *
 * Safe to run more than once: decoding an already-decoded value is a no-op,
 * and only rows that actually change are written.
 *
 *   pnpm --filter api-server run repair:scraped-entities
 *
 * Add DRY_RUN=1 to report what it would change without writing.
 */
import { db, whispsTable, whispRepliesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { decodeHtmlEntities } from "../lib/videoMeta";

const DRY_RUN = process.env.DRY_RUN === "1";

function repaired(value: string | null): string | null {
  if (!value) return null;
  const decoded = decodeHtmlEntities(value);
  return decoded === value ? null : decoded;
}

async function run(): Promise<void> {
  let whispsFixed = 0;
  let repliesFixed = 0;

  const whisps = await db
    .select({ id: whispsTable.id, videoTitle: whispsTable.videoTitle, videoThumbnail: whispsTable.videoThumbnail })
    .from(whispsTable);

  for (const row of whisps) {
    const title = repaired(row.videoTitle);
    const thumbnail = repaired(row.videoThumbnail);
    if (!title && !thumbnail) continue;

    whispsFixed++;
    console.log(
      `whisp ${row.id}${title ? `\n  title: ${row.videoTitle} -> ${title}` : ""}${
        thumbnail ? `\n  thumb: ${row.videoThumbnail} -> ${thumbnail}` : ""
      }`,
    );
    if (DRY_RUN) continue;

    await db
      .update(whispsTable)
      .set({
        ...(title ? { videoTitle: title } : {}),
        ...(thumbnail ? { videoThumbnail: thumbnail } : {}),
      })
      .where(eq(whispsTable.id, row.id));
  }

  // Replies carry the same scraped fields for a whisp-back video.
  const replies = await db
    .select({
      id: whispRepliesTable.id,
      videoTitle: whispRepliesTable.videoTitle,
      videoThumbnail: whispRepliesTable.videoThumbnail,
    })
    .from(whispRepliesTable);

  for (const row of replies) {
    const title = repaired(row.videoTitle);
    const thumbnail = repaired(row.videoThumbnail);
    if (!title && !thumbnail) continue;

    repliesFixed++;
    if (DRY_RUN) continue;

    await db
      .update(whispRepliesTable)
      .set({
        ...(title ? { videoTitle: title } : {}),
        ...(thumbnail ? { videoThumbnail: thumbnail } : {}),
      })
      .where(eq(whispRepliesTable.id, row.id));
  }

  console.log(
    `\n${DRY_RUN ? "[dry run] would repair" : "Repaired"} ${whispsFixed} whisp(s) and ${repliesFixed} reply/replies ` +
      `out of ${whisps.length} and ${replies.length} scanned.`,
  );
  process.exit(0);
}

run().catch((err) => {
  console.error("Repair failed:", err);
  process.exit(1);
});
