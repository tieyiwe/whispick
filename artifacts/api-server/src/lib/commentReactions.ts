import { randomUUID } from "crypto";
import { db, commentReactionsTable } from "@workspace/db";
import { eq, and, inArray, sql } from "drizzle-orm";

export type CommentType = "circle_comment" | "debate_topic_comment";
export type ReactionKind = "like" | "dislike";

export type ToggleReactionResult = { likeCount: number; dislikeCount: number; viewerReaction: ReactionKind | null };

// One row per (commentType, commentId, visitorId) — idempotent toggle, same
// model circle_post_likes uses. Tapping the SAME reaction again removes it
// (un-react); tapping the other one switches it. Returns the resulting
// counts + the viewer's own state so the caller never needs a second query.
export async function toggleReaction(commentType: CommentType, commentId: string, visitorId: string, reaction: ReactionKind): Promise<ToggleReactionResult> {
  const existing = await db
    .select({ id: commentReactionsTable.id, reaction: commentReactionsTable.reaction })
    .from(commentReactionsTable)
    .where(and(eq(commentReactionsTable.commentType, commentType), eq(commentReactionsTable.commentId, commentId), eq(commentReactionsTable.visitorId, visitorId)))
    .then((r) => r[0]);

  if (existing?.reaction === reaction) {
    await db.delete(commentReactionsTable).where(eq(commentReactionsTable.id, existing.id));
  } else if (existing) {
    await db.update(commentReactionsTable).set({ reaction }).where(eq(commentReactionsTable.id, existing.id));
  } else {
    await db.insert(commentReactionsTable).values({ id: randomUUID(), commentType, commentId, visitorId, reaction });
  }

  const counts = await reactionCountsFor(commentType, [commentId]);
  const viewerReaction = existing?.reaction === reaction ? null : reaction;
  return { ...(counts[commentId] ?? { likeCount: 0, dislikeCount: 0 }), viewerReaction };
}

// Batch counts for a whole thread's comments at once.
export async function reactionCountsFor(commentType: CommentType, commentIds: string[]): Promise<Record<string, { likeCount: number; dislikeCount: number }>> {
  if (!commentIds.length) return {};
  const rows = await db
    .select({
      commentId: commentReactionsTable.commentId,
      likeCount: sql<number>`count(*) filter (where ${commentReactionsTable.reaction} = 'like')`,
      dislikeCount: sql<number>`count(*) filter (where ${commentReactionsTable.reaction} = 'dislike')`,
    })
    .from(commentReactionsTable)
    .where(and(eq(commentReactionsTable.commentType, commentType), inArray(commentReactionsTable.commentId, commentIds)))
    .groupBy(commentReactionsTable.commentId);
  return Object.fromEntries(rows.map((r) => [r.commentId, { likeCount: Number(r.likeCount), dislikeCount: Number(r.dislikeCount) }]));
}

// Batch "what did THIS visitor react with" for a whole thread — separate
// from the counts above since counts are viewer-independent and cacheable,
// while this is per-visitor.
export async function viewerReactionsFor(commentType: CommentType, commentIds: string[], visitorId: string): Promise<Record<string, ReactionKind>> {
  if (!commentIds.length) return {};
  const rows = await db
    .select({ commentId: commentReactionsTable.commentId, reaction: commentReactionsTable.reaction })
    .from(commentReactionsTable)
    .where(and(eq(commentReactionsTable.commentType, commentType), inArray(commentReactionsTable.commentId, commentIds), eq(commentReactionsTable.visitorId, visitorId)));
  return Object.fromEntries(rows.map((r) => [r.commentId, r.reaction as ReactionKind]));
}
