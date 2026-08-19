import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { debateTopicsTable, debateTopicCommentsTable, debateTopicRewhispsTable, followsTable } from "@workspace/db";
import { eq, and, desc, lt, gt, count, inArray, isNull } from "drizzle-orm";
import { getAuth } from "@clerk/express";
import { randomUUID } from "crypto";
import { z } from "zod";
import { requireAuth } from "../lib/auth";
import { ensureUser } from "../lib/ensureUser";
import { canPostAnonymousComment, COMMENT_LIMIT_WINDOW_HOURS } from "../lib/plans";
import { createDebateTopicLimiter } from "../lib/rateLimit";
import { moderateDebateTopicAsync, moderateDebateTopicCommentAsync, moderateCommentImageAsync } from "../lib/moderation";
import { assignOrGetHandle, getHandlesFor, renameHandle } from "../lib/anonymousHandles";
import { assignOrGetWhispererHandle, getOrBackfillWhispererHandles } from "../lib/whispererHandle";
import { toggleReaction, reactionCountsFor, viewerReactionsFor } from "../lib/commentReactions";
import { commentImageUpload, storeCommentImage } from "../lib/commentImages";
import { notifyUserPersisted } from "../lib/push";
import { downloadObject } from "../lib/objectStorage";

const router: IRouter = Router();

function topicUrl(topicId: string): string {
  return `/debate-topics/${topicId}`;
}

// Title/subtitle length by product design: a debate topic is a headline to
// react to ("Is honesty always the best policy?"), not a paragraph to read.
// Enforced here (the one place every write path — POST /debate-topics —
// runs through) rather than only in the DB column, which has no length
// constraint of its own.
export const MAX_TOPIC_TEXT_LENGTH = 200;
export const MAX_COMMENT_TEXT_LENGTH = 500;

export const PAGE_SIZE = 20;

// A topic never surfaced once its author retracts it (see DELETE below) or
// an admin takes it down — every public lookup filters on this.
function notRetracted() {
  return and(isNull(debateTopicsTable.deletedByAuthorAt), isNull(debateTopicsTable.removedByAdminAt));
}

// Same exclusion for a single comment — an admin-removed comment (no
// author-retraction path of its own) never appears in a public thread read.
function commentNotRemoved() {
  return isNull(debateTopicCommentsTable.removedByAdminAt);
}

// POST /api/debate-topics — a signed-in Whisperer posts a new debate topic.
// Authenticated (unlike the Circle-style public endpoints below): posting is
// the one action here that needs an account to attribute authorship/
// moderation to and to rate-limit per-user, even though the author's
// identity is never shown to anyone who reads the topic.
router.post("/debate-topics", requireAuth, createDebateTopicLimiter, async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  const user = await ensureUser(userId!, req);

  const parsed = z.object({ topicText: z.string().trim().min(1).max(MAX_TOPIC_TEXT_LENGTH) }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const id = randomUUID();
  await db.insert(debateTopicsTable).values({
    id,
    authorId: user.id,
    topicText: parsed.data.topicText,
  });

  void moderateDebateTopicAsync({ debateTopicId: id, authorId: user.id, text: parsed.data.topicText });

  const authorHandle = await assignOrGetWhispererHandle(user.id);

  const topic = await db
    .select({ id: debateTopicsTable.id, topicText: debateTopicsTable.topicText, createdAt: debateTopicsTable.createdAt })
    .from(debateTopicsTable)
    .where(eq(debateTopicsTable.id, id))
    .then((r) => r[0]);

  res.status(201).json({ ...topic, authorHandle, commentCount: 0, rewhispCount: 0 });
});

// DELETE /api/debate-topics/:id — the author retracts their own topic.
// Unlike a whisp's sender-only soft delete, this takes the topic down from
// the PUBLIC feed/detail entirely (see notRetracted() above) — a debate
// topic has no single recipient whose own link should keep working, so
// there's no reason to keep showing it to the public once its author no
// longer wants it up. The row and its comment thread stay in the database
// for admin/moderation history, same as everywhere else in this app.
router.delete("/debate-topics/:id", requireAuth, async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  const user = await ensureUser(userId!, req);

  const topic = await db
    .select({ id: debateTopicsTable.id })
    .from(debateTopicsTable)
    .where(and(eq(debateTopicsTable.id, req.params.id), eq(debateTopicsTable.authorId, user.id), notRetracted()))
    .then((r) => r[0]);

  if (!topic) {
    res.status(404).json({ error: "Debate topic not found" });
    return;
  }

  await db.update(debateTopicsTable).set({ deletedByAuthorAt: new Date() }).where(eq(debateTopicsTable.id, topic.id));

  res.status(204).send();
});

// GET /api/debate-topics/following-feed — topics authored by accounts the
// caller follows, newest first, cursor-paginated same as the public feed.
// Authenticated: unlike the public feed, "who do I follow" is inherently
// tied to an account.
router.get("/debate-topics/following-feed", requireAuth, async (req, res): Promise<void> => {
  const { userId: clerkId } = getAuth(req);
  const viewer = await ensureUser(clerkId!, req);

  const cursor = typeof req.query.cursor === "string" ? req.query.cursor : undefined;
  let cursorDate: Date | undefined;
  if (cursor) {
    const parsedCursor = new Date(cursor);
    if (!Number.isNaN(parsedCursor.getTime())) cursorDate = parsedCursor;
  }

  const followedIds = await db.select({ followedUserId: followsTable.followedUserId }).from(followsTable).where(eq(followsTable.followerUserId, viewer.id));
  const followedUserIds = followedIds.map((r) => r.followedUserId);
  if (!followedUserIds.length) {
    res.json({ items: [], nextCursor: null });
    return;
  }

  const baseCondition = and(notRetracted(), inArray(debateTopicsTable.authorId, followedUserIds));
  const topics = await db
    .select({ id: debateTopicsTable.id, topicText: debateTopicsTable.topicText, createdAt: debateTopicsTable.createdAt, authorId: debateTopicsTable.authorId })
    .from(debateTopicsTable)
    .where(cursorDate ? and(baseCondition, lt(debateTopicsTable.createdAt, cursorDate)) : baseCondition)
    .orderBy(desc(debateTopicsTable.createdAt))
    .limit(PAGE_SIZE);

  const topicIds = topics.map((t) => t.id);
  const [counts, rewhispCounts, authorHandles] = await Promise.all([
    commentCountsFor(topicIds),
    rewhispCountsFor(topicIds),
    getOrBackfillWhispererHandles(topics.map((t) => t.authorId)),
  ]);
  const items = topics.map(({ authorId, ...t }) => ({
    ...t,
    authorHandle: authorHandles[authorId],
    commentCount: counts[t.id] ?? 0,
    rewhispCount: rewhispCounts[t.id] ?? 0,
  }));
  const nextCursor = topics.length === PAGE_SIZE ? topics[topics.length - 1]!.createdAt.toISOString() : null;

  res.json({ items, nextCursor });
});

// GET /api/debate-topics/my-stats — the CALLER's own topic engagement
// stats: how many topics they've posted, and how much engagement those
// topics (and their own comments) have drawn. Follow counts live at
// GET /api/follows/stats instead, kept separate since they're a distinct
// concept the frontend combines as needed.
router.get("/debate-topics/my-stats", requireAuth, async (req, res): Promise<void> => {
  const { userId: clerkId } = getAuth(req);
  const viewer = await ensureUser(clerkId!, req);

  const [[{ count: topicsPosted } = { count: 0 }], myTopicIdsRows] = await Promise.all([
    db.select({ count: count() }).from(debateTopicsTable).where(and(eq(debateTopicsTable.authorId, viewer.id), notRetracted())),
    db.select({ id: debateTopicsTable.id }).from(debateTopicsTable).where(and(eq(debateTopicsTable.authorId, viewer.id), notRetracted())),
  ]);
  const myTopicIds = myTopicIdsRows.map((r) => r.id);

  const [commentsReceived, rewhispsReceived, myCommentIdsRows] = await Promise.all([
    myTopicIds.length
      ? db.select({ count: count() }).from(debateTopicCommentsTable).where(and(inArray(debateTopicCommentsTable.topicId, myTopicIds), commentNotRemoved())).then((r) => r[0]?.count ?? 0)
      : Promise.resolve(0),
    myTopicIds.length
      ? db.select({ count: count() }).from(debateTopicRewhispsTable).where(inArray(debateTopicRewhispsTable.debateTopicId, myTopicIds)).then((r) => r[0]?.count ?? 0)
      : Promise.resolve(0),
    db.select({ id: debateTopicCommentsTable.id }).from(debateTopicCommentsTable).where(eq(debateTopicCommentsTable.authorUserId, viewer.id)),
  ]);
  const myCommentIds = myCommentIdsRows.map((r) => r.id);

  const commentLikeCounts = await reactionCountsFor("debate_topic_comment", myCommentIds);
  const commentLikesReceived = Object.values(commentLikeCounts).reduce((sum, c) => sum + c.likeCount, 0);

  res.json({
    topicsPosted,
    commentsReceived,
    rewhispsReceived,
    commentsPosted: myCommentIds.length,
    commentLikesReceived,
  });
});

async function commentCountsFor(topicIds: string[]): Promise<Record<string, number>> {
  if (!topicIds.length) return {};
  const rows = await db
    .select({ topicId: debateTopicCommentsTable.topicId, count: count() })
    .from(debateTopicCommentsTable)
    .where(and(inArray(debateTopicCommentsTable.topicId, topicIds), commentNotRemoved()))
    .groupBy(debateTopicCommentsTable.topicId);
  return Object.fromEntries(rows.map((r) => [r.topicId, r.count]));
}

async function rewhispCountsFor(topicIds: string[]): Promise<Record<string, number>> {
  if (!topicIds.length) return {};
  const rows = await db
    .select({ topicId: debateTopicRewhispsTable.debateTopicId, count: count() })
    .from(debateTopicRewhispsTable)
    .where(inArray(debateTopicRewhispsTable.debateTopicId, topicIds))
    .groupBy(debateTopicRewhispsTable.debateTopicId);
  return Object.fromEntries(rows.map((r) => [r.topicId, r.count]));
}

// GET /api/public/debate-topics — the public feed, no account needed to
// browse. Cursor-paginated on createdAt, newest first — same pattern as
// routes/circle.ts's community feed.
router.get("/public/debate-topics", async (req, res): Promise<void> => {
  const cursor = typeof req.query.cursor === "string" ? req.query.cursor : undefined;
  let cursorDate: Date | undefined;
  if (cursor) {
    const parsedCursor = new Date(cursor);
    if (!Number.isNaN(parsedCursor.getTime())) cursorDate = parsedCursor;
  }

  const baseCondition = notRetracted();

  // authorId is selected here ONLY to resolve it to the topic's public
  // authorHandle byline below — it's stripped out of every item before the
  // response goes out (see the .map() below), same anti-enumeration posture
  // as everywhere else authorId is touched in this file.
  const topics = await db
    .select({ id: debateTopicsTable.id, topicText: debateTopicsTable.topicText, createdAt: debateTopicsTable.createdAt, authorId: debateTopicsTable.authorId })
    .from(debateTopicsTable)
    .where(cursorDate ? and(baseCondition, lt(debateTopicsTable.createdAt, cursorDate)) : baseCondition)
    .orderBy(desc(debateTopicsTable.createdAt))
    .limit(PAGE_SIZE);

  const topicIds = topics.map((t) => t.id);
  const [counts, rewhispCounts, authorHandles] = await Promise.all([
    commentCountsFor(topicIds),
    rewhispCountsFor(topicIds),
    getOrBackfillWhispererHandles(topics.map((t) => t.authorId)),
  ]);
  const items = topics.map(({ authorId, ...t }) => ({
    ...t,
    authorHandle: authorHandles[authorId],
    commentCount: counts[t.id] ?? 0,
    rewhispCount: rewhispCounts[t.id] ?? 0,
  }));
  const nextCursor = topics.length === PAGE_SIZE ? topics[topics.length - 1]!.createdAt.toISOString() : null;

  res.json({ items, nextCursor });
});

// GET /api/public/debate-topics/:id — a single topic plus its full public
// comment thread. No account needed to read. visitorId is an optional query
// param (the caller's own localStorage-persisted anonymous id) purely so the
// response can include which reaction/rewhisp state is THEIRS — never used
// to identify who posted what to anyone else.
router.get("/public/debate-topics/:id", async (req, res): Promise<void> => {
  const topic = await db
    .select()
    .from(debateTopicsTable)
    .where(and(eq(debateTopicsTable.id, req.params.id), notRetracted()))
    .then((r) => r[0]);

  if (!topic) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  // Lets the topic's own author see a "Retract" control on their own topic
  // without revealing anything to anyone else — a ROLE flag computed
  // server-side, same trick isPoster uses on each comment below. Works even
  // on this "unauthenticated" router because clerkMiddleware runs globally
  // (app.ts).
  const { userId: clerkId } = getAuth(req);
  let isOwnTopic = false;
  let viewer: { id: string } | null = null;
  if (clerkId) {
    viewer = await ensureUser(clerkId, req);
    isOwnTopic = viewer.id === topic.authorId;
  }

  const visitorId = typeof req.query.visitorId === "string" ? req.query.visitorId : undefined;

  // visitorId (the comment's OWN, per-comment identifier — distinct from the
  // caller's own visitorId above) is deliberately excluded from what's
  // returned; only the thread-scoped anonymous handle it maps to is. Nothing
  // here identifies who posted a comment beyond isPoster (a ROLE, never an
  // identity) and that handle.
  const comments = await db
    .select({
      id: debateTopicCommentsTable.id,
      commentText: debateTopicCommentsTable.commentText,
      parentCommentId: debateTopicCommentsTable.parentCommentId,
      isPoster: debateTopicCommentsTable.isPoster,
      imageObjectKey: debateTopicCommentsTable.imageObjectKey,
      imageModerationStatus: debateTopicCommentsTable.imageModerationStatus,
      createdAt: debateTopicCommentsTable.createdAt,
      visitorId: debateTopicCommentsTable.visitorId,
      authorUserId: debateTopicCommentsTable.authorUserId,
    })
    .from(debateTopicCommentsTable)
    .where(and(eq(debateTopicCommentsTable.topicId, topic.id), commentNotRemoved()))
    .orderBy(debateTopicCommentsTable.createdAt);

  const commentIds = comments.map((c) => c.id);
  const signedInCommenterIds = comments.map((c) => c.authorUserId).filter((id): id is string => !!id);
  const [handles, whispererHandles, reactionCounts, viewerReactions, rewhispCounts] = await Promise.all([
    getHandlesFor("debate_topic", topic.id, comments.filter((c) => !c.authorUserId).map((c) => c.visitorId)),
    getOrBackfillWhispererHandles([topic.authorId, ...signedInCommenterIds]),
    reactionCountsFor("debate_topic_comment", commentIds),
    visitorId ? viewerReactionsFor("debate_topic_comment", commentIds, visitorId) : Promise.resolve({} as Record<string, "like" | "dislike">),
    rewhispCountsFor([topic.id]),
  ]);

  let viewerRewhisped = false;
  if (visitorId) {
    const row = await db
      .select({ id: debateTopicRewhispsTable.id })
      .from(debateTopicRewhispsTable)
      .where(and(eq(debateTopicRewhispsTable.debateTopicId, topic.id), eq(debateTopicRewhispsTable.visitorId, visitorId)))
      .then((r) => r[0]);
    viewerRewhisped = !!row;
  }

  // Follow state: only meaningful for a SIGNED-IN viewer looking at someone
  // else's byline/comment — an anonymous reader or the author looking at
  // their own topic gets `null` (not "false") so the frontend can tell
  // "can't follow" apart from "not following yet".
  const followableUserIds = [...new Set([topic.authorId, ...signedInCommenterIds])].filter((id) => id !== viewer?.id);
  let followedSet = new Set<string>();
  if (viewer && followableUserIds.length) {
    const rows = await db
      .select({ followedUserId: followsTable.followedUserId })
      .from(followsTable)
      .where(and(eq(followsTable.followerUserId, viewer.id), inArray(followsTable.followedUserId, followableUserIds)));
    followedSet = new Set(rows.map((r) => r.followedUserId));
  }
  const [{ count: authorFollowerCount } = { count: 0 }] = await db.select({ count: count() }).from(followsTable).where(eq(followsTable.followedUserId, topic.authorId));

  res.json({
    id: topic.id,
    topicText: topic.topicText,
    createdAt: topic.createdAt,
    isOwnTopic,
    authorHandle: whispererHandles[topic.authorId],
    authorFollowed: viewer && !isOwnTopic ? followedSet.has(topic.authorId) : null,
    authorFollowerCount,
    commentCount: comments.length,
    rewhispCount: rewhispCounts[topic.id] ?? 0,
    viewerRewhisped,
    // imageModerationStatus 'flagged' images are hidden from every reader
    // but the comment's own author (who can still see what they posted) —
    // never fully removed, just not surfaced while a human reviews it.
    comments: comments.map(({ visitorId: commentVisitorId, authorUserId: commentAuthorUserId, imageObjectKey, imageModerationStatus, ...c }) => ({
      ...c,
      // A signed-in commenter displays under their persistent, followable
      // Whisperer handle instead of the per-thread-only anonymous one — see
      // users.whispererHandle's comment for why that's the one deliberate
      // exception to this app's usual per-thread anonymity.
      handle: commentAuthorUserId ? whispererHandles[commentAuthorUserId] : (handles[commentVisitorId] ?? "Anonymous"),
      isOwnComment: visitorId ? commentVisitorId === visitorId : false,
      commentAuthorFollowed: commentAuthorUserId ? (viewer && commentAuthorUserId !== viewer.id ? followedSet.has(commentAuthorUserId) : null) : null,
      imageUrl: imageObjectKey && imageModerationStatus !== "flagged" ? `/api/public/debate-topics/comments/${c.id}/image` : null,
      likeCount: reactionCounts[c.id]?.likeCount ?? 0,
      dislikeCount: reactionCounts[c.id]?.dislikeCount ?? 0,
      viewerReaction: viewerReactions[c.id] ?? null,
    })),
  });
});

// POST /api/public/debate-topics/:id/comments — anonymous by default (see
// canPostAnonymousComment's rate limit below); isPoster is set only when the
// caller is signed in AND is this topic's own author, which happens to work
// even on this "unauthenticated" router because clerkMiddleware runs
// globally (app.ts) — same trick Blind Circle's own comment endpoint uses.
// multipart/form-data via commentImageUpload so an optional image can ride
// along with the same request instead of a separate upload-then-attach
// round trip; multer parses the other fields into req.body as plain strings
// either way, so the zod shape below is unaffected.
router.post("/public/debate-topics/:id/comments", commentImageUpload, async (req, res): Promise<void> => {
  const parsed = z
    .object({
      commentText: z.string().trim().min(1).max(MAX_COMMENT_TEXT_LENGTH),
      visitorId: z.string().min(1).max(100),
      parentCommentId: z.string().nullish(),
    })
    .safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const topic = await db
    .select({ id: debateTopicsTable.id, authorId: debateTopicsTable.authorId })
    .from(debateTopicsTable)
    .where(and(eq(debateTopicsTable.id, req.params.id), notRetracted()))
    .then((r) => r[0]);

  if (!topic) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const { userId: clerkId } = getAuth(req);
  let isPoster = false;
  let authorUserId: string | null = null;
  if (clerkId) {
    const user = await ensureUser(clerkId, req);
    authorUserId = user.id;
    isPoster = user.id === topic.authorId;
  }

  // The topic's own author commenting on their own topic is exempt, same
  // spirit as the anonymous reply cap's signed-in exemption elsewhere in
  // this app — they're not the audience this limit is aimed at.
  if (!isPoster) {
    const windowStart = new Date(Date.now() - COMMENT_LIMIT_WINDOW_HOURS * 60 * 60 * 1000);
    const [recentRow] = await db
      .select({ count: count() })
      .from(debateTopicCommentsTable)
      .where(and(eq(debateTopicCommentsTable.visitorId, parsed.data.visitorId), gt(debateTopicCommentsTable.createdAt, windowStart)));
    if (!canPostAnonymousComment(!!clerkId, recentRow?.count ?? 0)) {
      res.status(403).json({
        error: "You've used your free comments for now — sign up to comment anytime, or check back in 24 hours.",
        code: "comment_limit_reached",
      });
      return;
    }
  }

  // Same-topic check as circle_comments.parentCommentId — an unvalidated
  // parent id would let a comment quote one from a different topic's thread.
  let parentCommentId: string | null = null;
  let parentAuthorUserId: string | null = null;
  if (parsed.data.parentCommentId) {
    const parent = await db
      .select({ id: debateTopicCommentsTable.id, authorUserId: debateTopicCommentsTable.authorUserId })
      .from(debateTopicCommentsTable)
      .where(and(eq(debateTopicCommentsTable.id, parsed.data.parentCommentId), eq(debateTopicCommentsTable.topicId, topic.id)))
      .then((r) => r[0]);
    parentCommentId = parent?.id ?? null;
    parentAuthorUserId = parent?.authorUserId ?? null;
  }

  const id = randomUUID();
  let imageObjectKey: string | null = null;
  if (req.file) {
    imageObjectKey = await storeCommentImage(req.file);
  }

  await db.insert(debateTopicCommentsTable).values({
    id,
    topicId: topic.id,
    visitorId: parsed.data.visitorId,
    commentText: parsed.data.commentText,
    parentCommentId,
    isPoster,
    authorUserId,
    imageObjectKey,
    imageModerationStatus: imageObjectKey ? null : "ok",
  });

  // A signed-in commenter gets their persistent, followable Whisperer
  // handle instead of a fresh per-thread one — see users.whispererHandle's
  // comment for why. A purely anonymous (never-signed-in) commenter keeps
  // the ordinary per-thread handle, since there's no account to attach a
  // persistent identity to.
  const handle = authorUserId ? await assignOrGetWhispererHandle(authorUserId) : await assignOrGetHandle("debate_topic", topic.id, parsed.data.visitorId);

  void moderateDebateTopicCommentAsync({
    debateTopicCommentId: id,
    senderId: isPoster ? topic.authorId : null,
    text: parsed.data.commentText,
  });
  if (imageObjectKey) {
    void moderateCommentImageAsync({ commentType: "debate_topic_comment", commentId: id, senderId: authorUserId, imageObjectKey });
  }

  // Notify the person being replied to (their comment got a response) and,
  // separately, the topic's own author that their topic got a new comment —
  // both only reach a REAL account (authorUserId), since a genuinely
  // anonymous never-signed-in commenter has nowhere to be notified. Never
  // self-notify.
  if (parentAuthorUserId && parentAuthorUserId !== authorUserId) {
    void notifyUserPersisted(parentAuthorUserId, "New reply to your comment 💬", "Someone replied to your comment on a Debate Topic.", topicUrl(topic.id), "debate_comment_reply");
  }
  if (topic.authorId !== authorUserId && !isPoster) {
    void notifyUserPersisted(topic.authorId, "New comment on your Debate Topic 🗣️", "Someone joined the debate on a topic you posted.", topicUrl(topic.id), "debate_topic_comment");
  }

  const comment = await db
    .select({
      id: debateTopicCommentsTable.id,
      commentText: debateTopicCommentsTable.commentText,
      parentCommentId: debateTopicCommentsTable.parentCommentId,
      isPoster: debateTopicCommentsTable.isPoster,
      createdAt: debateTopicCommentsTable.createdAt,
    })
    .from(debateTopicCommentsTable)
    .where(eq(debateTopicCommentsTable.id, id))
    .then((r) => r[0]);

  res.status(201).json({
    ...comment,
    handle,
    isOwnComment: true,
    // Never true for the very comment you just posted — it's a foreign-
    // account-only concept and this is your own.
    commentAuthorFollowed: null,
    imageUrl: imageObjectKey ? `/api/public/debate-topics/comments/${id}/image` : null,
    likeCount: 0,
    dislikeCount: 0,
    viewerReaction: null,
  });
});

// GET /api/public/debate-topics/comments/:commentId/image — proxy-serves an
// attached comment image, same "stream bytes, never expose a raw storage
// URL" posture as routes/media.ts's own serving routes. Hidden (404) once
// flagged by moderation or once the comment itself is admin-removed.
router.get("/public/debate-topics/comments/:commentId/image", async (req, res): Promise<void> => {
  const comment = await db
    .select({ imageObjectKey: debateTopicCommentsTable.imageObjectKey, imageModerationStatus: debateTopicCommentsTable.imageModerationStatus, removedByAdminAt: debateTopicCommentsTable.removedByAdminAt })
    .from(debateTopicCommentsTable)
    .where(eq(debateTopicCommentsTable.id, req.params.commentId))
    .then((r) => r[0]);

  if (!comment?.imageObjectKey || comment.imageModerationStatus === "flagged" || comment.removedByAdminAt) {
    res.status(404).end();
    return;
  }

  const bytes = await downloadObject(comment.imageObjectKey);
  if (!bytes) {
    res.status(404).end();
    return;
  }

  const ext = comment.imageObjectKey.split(".").pop() ?? "jpg";
  const contentType = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : ext === "gif" ? "image/gif" : "image/jpeg";
  res.setHeader("Content-Type", contentType);
  res.setHeader("Content-Length", bytes.length.toString());
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.send(bytes);
});

// PATCH /api/public/debate-topics/:id/handle — a visitor renames their own
// anonymous handle within this one thread.
router.patch("/public/debate-topics/:id/handle", async (req, res): Promise<void> => {
  const parsed = z.object({ visitorId: z.string().min(1).max(100), handle: z.string().min(1).max(50) }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const result = await renameHandle("debate_topic", req.params.id, parsed.data.visitorId, parsed.data.handle);
  if (!result.ok) {
    res.status(400).json({ error: result.error === "taken" ? "That name is already taken in this thread." : "Use letters and numbers only (3-24 characters)." });
    return;
  }

  res.json({ handle: result.handle });
});

// POST /api/public/debate-topics/:id/comments/:commentId/reactions — like or
// dislike a comment; tapping the same reaction again removes it.
router.post("/public/debate-topics/:id/comments/:commentId/reactions", async (req, res): Promise<void> => {
  const parsed = z.object({ visitorId: z.string().min(1).max(100), reaction: z.enum(["like", "dislike"]) }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const comment = await db
    .select({ id: debateTopicCommentsTable.id, authorUserId: debateTopicCommentsTable.authorUserId })
    .from(debateTopicCommentsTable)
    .where(and(eq(debateTopicCommentsTable.id, req.params.commentId), eq(debateTopicCommentsTable.topicId, req.params.id), commentNotRemoved()))
    .then((r) => r[0]);
  if (!comment) {
    res.status(404).json({ error: "Comment not found" });
    return;
  }

  const result = await toggleReaction("debate_topic_comment", comment.id, parsed.data.visitorId, parsed.data.reaction);

  if (result.viewerReaction === "like" && comment.authorUserId) {
    void notifyUserPersisted(comment.authorUserId, "Someone liked your comment 👍", "Your comment on a Debate Topic got a reaction.", topicUrl(req.params.id), "debate_comment_reaction");
  }

  res.json(result);
});

// POST /api/public/debate-topics/:id/rewhisp — toggle: a visitor boosting a
// topic's visibility, retweet-style. Idempotent, no list of who ever exposed.
router.post("/public/debate-topics/:id/rewhisp", async (req, res): Promise<void> => {
  const parsed = z.object({ visitorId: z.string().min(1).max(100) }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const topic = await db
    .select({ id: debateTopicsTable.id })
    .from(debateTopicsTable)
    .where(and(eq(debateTopicsTable.id, req.params.id), notRetracted()))
    .then((r) => r[0]);
  if (!topic) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const existing = await db
    .select({ id: debateTopicRewhispsTable.id })
    .from(debateTopicRewhispsTable)
    .where(and(eq(debateTopicRewhispsTable.debateTopicId, topic.id), eq(debateTopicRewhispsTable.visitorId, parsed.data.visitorId)))
    .then((r) => r[0]);

  if (existing) {
    await db.delete(debateTopicRewhispsTable).where(eq(debateTopicRewhispsTable.id, existing.id));
  } else {
    await db.insert(debateTopicRewhispsTable).values({ id: randomUUID(), debateTopicId: topic.id, visitorId: parsed.data.visitorId });
  }

  const [{ count: rewhispCount } = { count: 0 }] = await db
    .select({ count: count() })
    .from(debateTopicRewhispsTable)
    .where(eq(debateTopicRewhispsTable.debateTopicId, topic.id));

  res.json({ rewhispCount, viewerRewhisped: !existing });
});

export default router;
