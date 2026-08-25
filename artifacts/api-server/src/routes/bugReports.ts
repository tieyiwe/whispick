import { Router, type IRouter } from "express";
import { getAuth } from "@clerk/express";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { recordBugReport } from "../lib/bugRabbit";
import { bugReportLimiter } from "../lib/rateLimit";

const router: IRouter = Router();

const reportBugSchema = z.object({
  message: z.string().min(1).max(2000),
  stack: z.string().max(8000).optional(),
  url: z.string().max(500).optional(),
});

// POST /api/public/bug-reports — BugRabbit's frontend ingestion sink.
// Public on purpose (an error can happen before sign-in resolves, or on a
// fully public page — the landing page, a shared /w/:token link), inheriting
// the shared publicEndpointLimiter AND its own tighter bugReportLimiter (see
// that limiter's own comment for why it's separate). Fire-and-forget from
// the client (lib/bugRabbitCapture.ts uses sendBeacon/fetch with no retry),
// so this always returns 204 once the payload shape checks out — a failure
// recording a bug report must never itself surface as a second bug report.
router.post("/bug-reports", bugReportLimiter, async (req, res): Promise<void> => {
  const parsed = reportBugSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid bug report payload" });
    return;
  }

  // Optional identity, same posture as routes/usageEvents.ts: resolve the
  // internal user id only when a session is present, never calls ensureUser
  // (a crash report is not a reason to create an account or touch lastSeen).
  let userId: string | null = null;
  const { userId: clerkId } = getAuth(req);
  if (clerkId) {
    const user = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.clerkId, clerkId)).then((r) => r[0]);
    userId = user?.id ?? null;
  }

  await recordBugReport({
    source: "frontend",
    message: parsed.data.message,
    stack: parsed.data.stack ?? null,
    url: parsed.data.url ?? null,
    userAgent: req.headers["user-agent"] ?? null,
    userId,
  });

  res.status(204).send();
});

export default router;
