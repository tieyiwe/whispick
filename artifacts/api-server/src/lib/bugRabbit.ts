import { createHash, randomUUID } from "crypto";
import { db, bugIssuesTable, bugOccurrencesTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { scrubPii, scrubUrl } from "./piiScrub";
import { logger } from "./logger";

// BugRabbit — the in-house error tracker: catch what's breaking for real
// users, in time to fix and redeploy, without shipping a third-party SDK
// (and its own PII-handling questions) into the app. See bug_reports.ts's
// own schema comment for the two-table (issue/occurrence) shape.

const MAX_MESSAGE_LEN = 500;
const MAX_STACK_LEN = 4000;
const MAX_URL_LEN = 300;
// Detailed occurrence rows stop accumulating past this many for one issue —
// occurrenceCount/lastSeenAt on the issue itself keep counting regardless,
// so a hot error loop still shows an accurate frequency, it just can't grow
// the table without bound. Enough occurrences survive to see whether the
// stack/route/user varies from one hit to the next.
export const MAX_STORED_OCCURRENCES = 20;

export type BugSource = "frontend" | "backend";

// Groups occurrences of the SAME underlying bug together regardless of the
// exact ids/timestamps embedded in a given instance's message, and
// regardless of the exact line:column a minified bundle attaches (those
// shift across builds even for the truly identical bug). Not meant to be
// perfect — two genuinely distinct bugs that happen to produce
// near-identical top frames could collide into one issue — but a false
// merge is a fine tradeoff against flooding the queue with duplicates,
// which is the failure mode this exists to prevent.
export function fingerprintFor(source: BugSource, message: string, stack?: string | null): string {
  const normalizedMessage = message
    .toLowerCase()
    .replace(/0x[0-9a-f]+/gi, "<hex>")
    .replace(/\d+/g, "<n>")
    .replace(/["'][^"']{0,80}["']/g, "<str>")
    .slice(0, 200);

  // Skip the first line ("Error: message", already covered above) and take
  // the next few frames — stable across most builds for the same call site,
  // and dropping the trailing ":line:col" keeps a webpack/vite content-hash
  // rename or a shifted line number from splitting one bug into two issues.
  const topFrames = (stack ?? "")
    .split("\n")
    .slice(1, 4)
    .map((line) => line.trim().replace(/:\d+:\d+\)?$/, ""))
    .join("|");

  const basis = `${source}|${normalizedMessage}|${topFrames}`;
  return createHash("sha256").update(basis).digest("hex").slice(0, 32);
}

export interface RecordBugReportInput {
  source: BugSource;
  message: string;
  stack?: string | null;
  url?: string | null;
  userAgent?: string | null;
  userId?: string | null;
}

// Upserts the grouped issue (increment + touch lastSeenAt, or insert a new
// one on the first occurrence) and, while still under the per-issue cap,
// records this specific occurrence. Every free-text field is scrubbed here
// — the one and only place a report's text is written to the database —
// so no call site can accidentally skip it.
export async function recordBugReport(input: RecordBugReportInput): Promise<void> {
  try {
    const message = scrubPii(input.message).slice(0, MAX_MESSAGE_LEN) || "(empty error message)";
    const stack = input.stack ? scrubPii(input.stack).slice(0, MAX_STACK_LEN) : null;
    const url = input.url ? scrubUrl(input.url, MAX_URL_LEN) : null;
    const userAgent = input.userAgent ? input.userAgent.slice(0, 300) : null;
    const fingerprint = fingerprintFor(input.source, message, stack);

    // Common case first: this exact bug has already been seen, so a plain
    // increment covers it without ever attempting a doomed insert.
    const incrementExisting = () =>
      db
        .update(bugIssuesTable)
        .set({ occurrenceCount: sql`${bugIssuesTable.occurrenceCount} + 1`, lastSeenAt: new Date() })
        .where(eq(bugIssuesTable.fingerprint, fingerprint))
        .returning()
        .then((r) => r[0]);

    let issue = await incrementExisting();

    if (!issue) {
      try {
        issue = await db
          .insert(bugIssuesTable)
          .values({ id: randomUUID(), fingerprint, source: input.source, message })
          .returning()
          .then((r) => r[0]!);
      } catch {
        // Lost a race against a concurrent first occurrence of the same
        // fingerprint — the insert above already happened elsewhere, so
        // fall back to the increment path.
        issue = await incrementExisting();
      }
    }

    if (!issue) return; // Shouldn't happen, but never let telemetry throw past this point.

    if (issue.occurrenceCount <= MAX_STORED_OCCURRENCES) {
      await db.insert(bugOccurrencesTable).values({
        id: randomUUID(),
        issueId: issue.id,
        stack,
        url,
        userAgent,
        userId: input.userId ?? null,
      });
    }
  } catch (err) {
    // A telemetry failure must never be the thing that breaks the request
    // (or, worse, the error handler itself) it's trying to report — same
    // fire-and-forget posture as lib/adminAudit.ts's logAdminAction.
    logger.error({ err }, "Failed to record bug report");
  }
}

// Convenience wrapper for every backend call site OUTSIDE the Express
// request/response cycle — the ~10 setInterval-based background schedulers
// (reminderScheduler, matchScheduler, the content agents, etc.), and the
// process-level uncaughtException/unhandledRejection nets in index.ts.
// app.ts's terminal error handler covers a thrown/rejected route handler;
// nothing else does, since Express error middleware only ever sees errors
// passed through its own request pipeline — an error thrown inside a
// setInterval callback, or a fire-and-forget `void someAsyncFn()` that
// rejects, never reaches it. `context` is a short, stable label (e.g.
// "scheduler:reminderScheduler") stored in the same `url` column
// route-sourced reports use for the request path — there's no real URL for
// a background job, but the column is otherwise exactly "where this
// happened," which a synthetic label serves just as well.
export function reportSystemError(err: unknown, context: string): void {
  const error = err instanceof Error ? err : new Error(String(err));
  void recordBugReport({
    source: "backend",
    message: error.message,
    stack: error.stack ?? null,
    url: context,
    userAgent: null,
    userId: null,
  });
}
