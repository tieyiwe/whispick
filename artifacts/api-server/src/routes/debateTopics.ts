import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { debateTopicsTable, debateTopicCommentsTable } from "@workspace/db";
import { eq, and, desc, lt, gt, count, inArray, isNull } from "drizzle-orm";
import { getAuth } from "@clerk/express";
import { randomUUID } from "crypto";
import { z } from "zod";
import { requireAuth } from "../lib/auth";
import { ensureUser } from "../lib/ensureUser";
import { canPostAnonymousComment, COMMENT_LIMIT_WINDOW_HOURS } from "../lib/plans";
import { createDebateTopicLimiter } from "../lib/rateLimit";
import { moderateDebateTopicAsync, moderateDebateTopicCommentAsync } from "../lib/moderation";

const router: IRouter = Router();

// Title/subtitle length by product design: a debate topic is a headline to
// react to ("Is honesty always the best policy?"), not a paragraph to read.
// Enforced here (the one place every write path — POST /debate-topics —
// runs through) rather than only in the DB column, which has no length
// constraint of its own.
export const MAX_TOPIC_TEXT_LENGTH = 200;
export const MAX_COMMENT_TEXT_LENGTH = 500;

export const PAGE_SIZE = 20;

// A topic never surfaced once its author retracts it (see DELETE below) —
// every public lookup filters on this.
function notRetracted() {
  return isNull(debateTopicsTable.deletedByAuthorAt);
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

  const topic = await db
    .select({ id: debateTopicsTable.id, topicText: debateTopicsTable.topicText, createdAt: debateTopicsTable.createdAt })
    .from(debateTopicsTable)
    .where(eq(debateTopicsTable.id, id))
    .then((r) => r[0]);

  res.status(201).json({ ...topic, commentCount: 0 });
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

async function commentCountsFor(topicIds: string[]): Promise<Record<string, number>> {
  if (!topicIds.length) return {};
  const rows = await db
    .select({ topicId: debateTopicCommentsTable.topicId, count: count() })
    .from(debateTopicCommentsTable)
    .where(inArray(debateTopicCommentsTable.topicId, topicIds))
    .groupBy(debateTopicCommentsTable.topicId);
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

  // authorId deliberately excluded from every column selected below — a
  // debate topic is posted anonymously, same as every other posting surface
  // in this app.
  const topics = await db
    .select({ id: debateTopicsTable.id, topicText: debateTopicsTable.topicText, createdAt: debateTopicsTable.createdAt })
    .from(debateTopicsTable)
    .where(cursorDate ? and(baseCondition, lt(debateTopicsTable.createdAt, cursorDate)) : baseCondition)
    .orderBy(desc(debateTopicsTable.createdAt))
    .limit(PAGE_SIZE);

  const counts = await commentCountsFor(topics.map((t) => t.id));
  const items = topics.map((t) => ({ ...t, commentCount: counts[t.id] ?? 0 }));
  const nextCursor = topics.length === PAGE_SIZE ? topics[topics.length - 1]!.createdAt.toISOString() : null;

  res.json({ items, nextCursor });
});

// GET /api/public/debate-topics/:id — a single topic plus its full public
// comment thread. No account needed to read.
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
  if (clerkId) {
    const user = await ensureUser(clerkId, req);
    isOwnTopic = user.id === topic.authorId;
  }

  // visitorId is deliberately excluded — it's how a comment's OWN author
  // recognizes it client-side (matched against the visitorId stored in
  // their own localStorage), not something any other viewer should ever
  // receive. Nothing here identifies who posted a comment beyond isPoster,
  // which reveals a ROLE (the topic's own author), never an identity.
  const comments = await db
    .select({
      id: debateTopicCommentsTable.id,
      commentText: debateTopicCommentsTable.commentText,
      parentCommentId: debateTopicCommentsTable.parentCommentId,
      isPoster: debateTopicCommentsTable.isPoster,
      createdAt: debateTopicCommentsTable.createdAt,
    })
    .from(debateTopicCommentsTable)
    .where(eq(debateTopicCommentsTable.topicId, topic.id))
    .orderBy(debateTopicCommentsTable.createdAt);

  res.json({
    id: topic.id,
    topicText: topic.topicText,
    createdAt: topic.createdAt,
    isOwnTopic,
    commentCount: comments.length,
    comments,
  });
});

// POST /api/public/debate-topics/:id/comments — anonymous by default (see
// canPostAnonymousComment's rate limit below); isPoster is set only when the
// caller is signed in AND is this topic's own author, which happens to work
// even on this "unauthenticated" router because clerkMiddleware runs
// globally (app.ts) — same trick Blind Circle's own comment endpoint uses.
router.post("/public/debate-topics/:id/comments", async (req, res): Promise<void> => {
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
  if (clerkId) {
    const user = await ensureUser(clerkId, req);
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
  if (parsed.data.parentCommentId) {
    const parent = await db
      .select({ id: debateTopicCommentsTable.id })
      .from(debateTopicCommentsTable)
      .where(and(eq(debateTopicCommentsTable.id, parsed.data.parentCommentId), eq(debateTopicCommentsTable.topicId, topic.id)))
      .then((r) => r[0]);
    parentCommentId = parent?.id ?? null;
  }

  const id = randomUUID();
  await db.insert(debateTopicCommentsTable).values({
    id,
    topicId: topic.id,
    visitorId: parsed.data.visitorId,
    commentText: parsed.data.commentText,
    parentCommentId,
    isPoster,
  });

  void moderateDebateTopicCommentAsync({
    debateTopicCommentId: id,
    senderId: isPoster ? topic.authorId : null,
    text: parsed.data.commentText,
  });

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

  res.status(201).json(comment);
});

export default router;
