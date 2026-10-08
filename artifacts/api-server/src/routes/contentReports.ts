import { Router, type IRouter } from "express";
import { db, contentReportsTable, debateTopicsTable, debateTopicCommentsTable } from "@workspace/db";
import { eq, and, isNull } from "drizzle-orm";
import { getAuth } from "@clerk/express";
import { randomUUID } from "crypto";
import { z } from "zod";
import { requireAuth } from "../lib/auth";
import { ensureUser } from "../lib/ensureUser";
import { reportContentLimiter } from "../lib/rateLimit";

const router: IRouter = Router();

// The reasons a reporter can pick from — mirrored by the frontend's
// ReportContentDialog (its i18n keys) and by the Community Guidelines page
// each maps back to. Adding one means: here, the dialog's list, and
// REASON_PRIORITY below.
export const REPORT_REASONS = [
  "child_safety",
  "threat_or_violence",
  "sexual_content",
  "hate_speech",
  "self_harm",
  "harassment",
  "inappropriate",
  "misinformation",
  "spam_or_scam",
  "other",
] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

// Default triage priority per reason — how the admin queue orders itself
// before any human has looked (routes/admin.ts sorts critical → low). An
// admin can re-triage an individual report afterward (PATCH
// /admin/content-reports/:id), which is why priority is STORED on the row
// (content_reports.ts) rather than recomputed from reason on every read.
// The ranking follows harm severity and time-sensitivity: child safety and
// threats can have real-world stakes measured in hours; spam can wait.
export const REASON_PRIORITY: Record<ReportReason, "critical" | "high" | "medium" | "low"> = {
  child_safety: "critical",
  threat_or_violence: "critical",
  sexual_content: "high",
  hate_speech: "high",
  self_harm: "high",
  harassment: "medium",
  inappropriate: "medium",
  misinformation: "medium",
  spam_or_scam: "low",
  other: "low",
};

// The detail box is capped in WORDS (product decision — "300 words max"),
// not characters, so the zod refine below counts whitespace-separated
// tokens. The character ceiling alongside it just bounds storage/abuse —
// 300 real words fit comfortably under it.
export const MAX_DETAIL_WORDS = 300;
const MAX_DETAIL_CHARS = 3000;

function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

const createReportSchema = z.object({
  contentType: z.enum(["debate_topic", "debate_topic_comment"]),
  contentId: z.string().min(1).max(64),
  reason: z.enum(REPORT_REASONS),
  detail: z
    .string()
    .trim()
    .max(MAX_DETAIL_CHARS)
    .refine((text) => countWords(text) <= MAX_DETAIL_WORDS, {
      message: `Please keep the detail under ${MAX_DETAIL_WORDS} words.`,
    })
    .nullable()
    .optional(),
});

// POST /api/content-reports — a signed-in user reports a piece of Debate
// Now content. Auth is required (not because anonymous readers matter less,
// but because the admin's resolution flows back to the reporter as an
// in-app notification, and only an account can receive one — see
// content_reports.ts). The content must still be publicly visible: a 404
// for content that never existed or was retracted, and a plain success for
// content an admin ALREADY took down would each leak moderation state, so
// already-removed content 404s too — from the reporter's perspective,
// "gone" is one state, however it got that way.
router.post("/content-reports", requireAuth, reportContentLimiter, async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  const user = await ensureUser(userId!, req);

  const parsed = createReportSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { contentType, contentId, reason } = parsed.data;
  const detail = parsed.data.detail?.trim() || null;

  if (contentType === "debate_topic") {
    const topic = await db
      .select({ id: debateTopicsTable.id })
      .from(debateTopicsTable)
      .where(and(eq(debateTopicsTable.id, contentId), isNull(debateTopicsTable.deletedByAuthorAt), isNull(debateTopicsTable.removedByAdminAt)))
      .then((r) => r[0]);
    if (!topic) {
      res.status(404).json({ error: "This content is no longer available." });
      return;
    }
  } else {
    const comment = await db
      .select({ id: debateTopicCommentsTable.id })
      .from(debateTopicCommentsTable)
      .where(and(eq(debateTopicCommentsTable.id, contentId), isNull(debateTopicCommentsTable.removedByAdminAt)))
      .then((r) => r[0]);
    if (!comment) {
      res.status(404).json({ error: "This content is no longer available." });
      return;
    }
  }

  // One live (unresolved) report per reporter per piece of content —
  // repeat-clicking "report" shouldn't stack queue entries. A NEW report on
  // the same content after a previous one was resolved is allowed on
  // purpose: "reviewed and left up" content can still cross the line later
  // (e.g. an edit-free thread whose meaning changes as replies land), and
  // that fresh report deserves fresh eyes.
  const contentIdColumn =
    contentType === "debate_topic" ? contentReportsTable.debateTopicId : contentReportsTable.debateTopicCommentId;
  const existing = await db
    .select({ id: contentReportsTable.id })
    .from(contentReportsTable)
    .where(
      and(
        eq(contentReportsTable.reporterUserId, user.id),
        eq(contentIdColumn, contentId),
        eq(contentReportsTable.status, "open"),
      ),
    )
    .then((r) => r[0]);
  if (existing) {
    res.status(409).json({ error: "You've already reported this — our team will review it." });
    return;
  }

  const id = randomUUID();
  await db.insert(contentReportsTable).values({
    id,
    contentType,
    debateTopicId: contentType === "debate_topic" ? contentId : null,
    debateTopicCommentId: contentType === "debate_topic_comment" ? contentId : null,
    reporterUserId: user.id,
    reason,
    detail,
    priority: REASON_PRIORITY[reason],
    status: "open",
  });

  res.status(201).json({ id, status: "open" });
});

export default router;
