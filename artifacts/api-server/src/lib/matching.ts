import { db, whispsTable, whispCategoriesTable, matchSubscribersTable } from "@workspace/db";
import { eq, and, or, isNull, lte, sql, count } from "drizzle-orm";
import { randomUUID } from "crypto";
import { sendEmail, whisperLinkEmailHtml, subscriptionMatchedEmailFooter } from "./email";
import { matchHookLine } from "./copy";
import { computeExpiresAt } from "./expiration";
import { logger } from "./logger";

// A subscriber won't be matched again until this long after their last
// match — simpler than counting sends in a rolling window, and just as
// effective at preventing one eager subscriber's inbox from being flooded.
export const MATCH_COOLDOWN_HOURS = 48;

// Bounds a single Ghost Boost whisp's total reach over its whole lifetime
// (not per sweep — see matchGhostBoostWhisp), regardless of how many
// subscribers match its category.
export const MAX_MATCHES_PER_SEND = 10;

// How long a Ghost Boost whisp keeps trying to find new matches before
// giving up. Early on, subscriber count will be low (a real cold-start
// problem for any opt-in audience) — a whisp that only ever gets one
// attempt right at creation would rarely find anyone yet. Retrying across a
// window gives it a real chance to reach people who subscribe later,
// without querying forever.
export const MATCHING_WINDOW_DAYS = 14;

// categorizeWhispAsync runs fire-and-forget right after a whisp is created —
// give it a little time before falling back to a broad (any-category) match
// rather than waiting indefinitely for categories that may never land (a
// non-YouTube video with no scrapable transcript still gets title-only
// categories almost immediately, but this is a safety margin, not the
// expected case).
const CATEGORIZATION_GRACE_MINUTES = 5;

// Fans a single Ghost Boost whisp out to new subscribers whose interests
// overlap its categories, up to MAX_MATCHES_PER_SEND total across its whole
// matching window — one whisp row per match (same "shared groupSendId ties
// them back to one logical send" pattern Group Whisper uses), each
// delivered over email exactly like a Whisper Link. Anonymous both ways:
// the sender never learns which subscribers matched (only an aggregate
// count, see routes/whisps.ts's GET /:id/matches), and a subscriber never
// learns who sent it. Returns 'done' once the campaign is finished (quota
// filled or window closed) so the caller can mark it terminal.
export async function matchGhostBoostWhisp(
  whisp: typeof whispsTable.$inferSelect,
  appUrl: string,
): Promise<{ newMatches: number; totalMatched: number; done: boolean }> {
  const alreadyMatchedRows = await db
    .select({ email: whispsTable.recipientEmail })
    .from(whispsTable)
    .where(eq(whispsTable.groupSendId, whisp.id));
  const alreadyMatchedEmails = new Set(alreadyMatchedRows.map((r) => r.email).filter((e): e is string => !!e));

  const remaining = MAX_MATCHES_PER_SEND - alreadyMatchedEmails.size;
  const windowExpired = Date.now() - new Date(whisp.createdAt).getTime() > MATCHING_WINDOW_DAYS * 24 * 60 * 60 * 1000;

  if (remaining <= 0 || windowExpired) {
    return { newMatches: 0, totalMatched: alreadyMatchedEmails.size, done: true };
  }

  const categoryRows = await db
    .select({ category: whispCategoriesTable.category })
    .from(whispCategoriesTable)
    .where(eq(whispCategoriesTable.whispId, whisp.id));
  // categorizeVideo() always inserts at least a fallback "uncategorized" row
  // when nothing matched — that's not a real topic anyone can subscribe to
  // (excluded from subscribe.ts's VALID_CATEGORY_KEYS), so treat it the same
  // as "no categories yet" rather than letting it block matching forever.
  const categories = categoryRows.map((r) => r.category).filter((c) => c !== "uncategorized");

  const isOldEnoughForBroadFallback = Date.now() - new Date(whisp.createdAt).getTime() > CATEGORIZATION_GRACE_MINUTES * 60 * 1000;
  if (categories.length === 0 && !isOldEnoughForBroadFallback) {
    return { newMatches: 0, totalMatched: alreadyMatchedEmails.size, done: false }; // still waiting on categorization — try again next sweep
  }

  const cooldownCutoff = new Date(Date.now() - MATCH_COOLDOWN_HOURS * 60 * 60 * 1000);
  // A bare `${categories}` interpolation expands a JS array into a
  // parenthesized placeholder list (e.g. `($1, $2)`, meant for IN (...)),
  // not a Postgres array literal — build an explicit ARRAY[...] instead so
  // the array-overlap operator gets a real text[] to compare against.
  const categoriesArray = sql`ARRAY[${sql.join(categories.map((c) => sql`${c}`), sql.raw(","))}]::text[]`;
  const eligibility = and(
    sql`${matchSubscribersTable.verifiedAt} is not null`,
    isNull(matchSubscribersTable.unsubscribedAt),
    or(isNull(matchSubscribersTable.lastMatchedAt), lte(matchSubscribersTable.lastMatchedAt, cooldownCutoff)),
    categories.length > 0 ? sql`${matchSubscribersTable.categories} && ${categoriesArray}` : sql`true`,
  );

  // Over-fetch a bit since some candidates will be filtered out below for
  // already having this exact campaign (cheaper than a correlated subquery
  // given how small MAX_MATCHES_PER_SEND is).
  const candidates = (
    await db
      .select()
      .from(matchSubscribersTable)
      .where(eligibility)
      .orderBy(sql`random()`)
      .limit(remaining + alreadyMatchedEmails.size)
  )
    .filter((c) => !alreadyMatchedEmails.has(c.email))
    .slice(0, remaining);

  if (candidates.length === 0) {
    return { newMatches: 0, totalMatched: alreadyMatchedEmails.size, done: false }; // no one new yet — keep trying until the window closes
  }

  const hookLine = matchHookLine();

  for (const subscriber of candidates) {
    const id = randomUUID();
    const publicToken = randomUUID().replace(/-/g, "");

    await db.insert(whispsTable).values({
      id,
      senderId: whisp.senderId,
      videoUrl: whisp.videoUrl,
      videoTitle: whisp.videoTitle,
      videoThumbnail: whisp.videoThumbnail,
      videoEmbedUrl: whisp.videoEmbedUrl,
      videoStartSeconds: whisp.videoStartSeconds,
      videoEndSeconds: whisp.videoEndSeconds,
      videoPlatform: whisp.videoPlatform,
      uploadedVideoId: whisp.uploadedVideoId,
      deliveryMethod: "ghost_boost",
      whisperChannel: "email",
      groupSendId: whisp.id,
      recipientEmail: subscriber.email,
      anonymousNote: whisp.anonymousNote,
      senderAlias: whisp.senderAlias,
      moodTag: whisp.moodTag,
      status: "delivered",
      publicToken,
      deliveredAt: new Date(),
      expiresAt: computeExpiresAt(),
    });

    // A subscription-list send (not a one-to-one Whisper Link), so unlike
    // deliverWhisperLink this always needs an unsubscribe link on the
    // email itself — hence the direct sendEmail call instead of reusing
    // that shared helper.
    const sharedUrl = `${appUrl}/api/l/${publicToken}`;
    const unsubscribeUrl = `${appUrl}/unsubscribe?token=${subscriber.token}`;
    void sendEmail(
      subscriber.email,
      hookLine,
      whisperLinkEmailHtml(sharedUrl, hookLine) + subscriptionMatchedEmailFooter(unsubscribeUrl),
    );

    await db.update(matchSubscribersTable).set({ lastMatchedAt: new Date() }).where(eq(matchSubscribersTable.id, subscriber.id));
  }

  logger.info({ whispId: whisp.id, matched: candidates.length }, "Matched Ghost Boost whisp to subscribers");

  const totalMatched = alreadyMatchedEmails.size + candidates.length;
  return { newMatches: candidates.length, totalMatched, done: totalMatched >= MAX_MATCHES_PER_SEND };
}

// Aggregate stats for a Ghost Boost campaign's own detail view — never a
// per-subscriber breakdown, since the whole point is that the sender never
// learns who specifically it reached.
export async function getGhostBoostMatchStats(whispId: string) {
  // count(*) is a Postgres bigint, which node-postgres returns as a string
  // to avoid silently truncating values beyond Number's safe range — fine
  // for drizzle's own count() helper (it calls .mapWith(Number) internally)
  // but these hand-written filtered counts need the same treatment,
  // otherwise MatchStats ships strings where the OpenAPI contract says
  // integer.
  const [row] = await db
    .select({
      matchedCount: count(),
      openedCount: sql<number>`count(*) filter (where ${whispsTable.openedAt} is not null)`.mapWith(Number),
      watchedCount: sql<number>`count(*) filter (where ${whispsTable.watchedAt} is not null)`.mapWith(Number),
      repliedCount: sql<number>`count(*) filter (where ${whispsTable.status} = 'replied')`.mapWith(Number),
      appreciatedCount: sql<number>`count(*) filter (where ${whispsTable.appreciationResponse} = 'yes')`.mapWith(Number),
    })
    .from(whispsTable)
    .where(eq(whispsTable.groupSendId, whispId));

  return row ?? { matchedCount: 0, openedCount: 0, watchedCount: 0, repliedCount: 0, appreciatedCount: 0 };
}
