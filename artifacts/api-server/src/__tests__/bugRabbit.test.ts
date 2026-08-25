import { describe, it, expect } from "vitest";
import { randomUUID } from "crypto";
import { db, bugIssuesTable, bugOccurrencesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { fingerprintFor, recordBugReport, MAX_STORED_OCCURRENCES } from "../lib/bugRabbit";

// Digit-free so it can never accidentally trip piiScrub's phone-number
// pattern (a plain randomUUID() sometimes contains a long enough all-digit
// hex segment to look phone-like — see piiScrub.test.ts) — keeps a marker
// embedded in a test message byte-for-byte identical before and after
// scrubbing, so fingerprintFor computed on the raw message here still
// matches what recordBugReport actually stored.
function safeMarker(): string {
  return randomUUID().replace(/[0-9]/g, "z");
}

describe("fingerprintFor", () => {
  it("groups the same error message + stack shape into the same fingerprint regardless of embedded numeric ids", () => {
    const stackA = "Error: whisp 39412 not found\n    at getWhisp (whisps.ts:42:11)\n    at handler (routes.ts:10:3)";
    const stackB = "Error: whisp 88213 not found\n    at getWhisp (whisps.ts:44:9)\n    at handler (routes.ts:10:3)";
    expect(fingerprintFor("backend", "whisp 39412 not found", stackA)).toBe(
      fingerprintFor("backend", "whisp 88213 not found", stackB),
    );
  });

  it("gives a different source a different fingerprint even with the same message", () => {
    expect(fingerprintFor("frontend", "Network request failed")).not.toBe(
      fingerprintFor("backend", "Network request failed"),
    );
  });

  it("gives a genuinely different message a different fingerprint", () => {
    expect(fingerprintFor("frontend", "Cannot read properties of undefined")).not.toBe(
      fingerprintFor("frontend", "Maximum call stack size exceeded"),
    );
  });
});

async function issueFor(fingerprint: string) {
  return db.select().from(bugIssuesTable).where(eq(bugIssuesTable.fingerprint, fingerprint)).then((r) => r[0]);
}

describe("recordBugReport", () => {
  it("creates a new issue on the first occurrence and scrubs PII out of the stored message/stack", async () => {
    const marker = safeMarker();
    // The marker sits outside the email span deliberately — the whole point
    // of this test is that the email itself gets replaced, so the marker
    // can't live inside it and still be findable afterward. The fingerprint
    // this test looks the issue up by is computed from the SAME (still raw)
    // message/stack recordBugReport was given — fingerprintFor runs before
    // scrubbing internally, on the scrubbed text, but message/stack here
    // have no phone/JWT/secret-shaped content for the scrubber to touch
    // (only the email span does), so the scrubbed vs. raw fingerprint basis
    // still diverges — hence looking this one up by marker containment
    // instead, same as every other test in this file.
    const message = `Failed to save profile ${marker} for user@example.com`;
    const stack = "Error\n    at save (profile.ts:1:1)\n    at click (button.ts:9:1)";
    await recordBugReport({ source: "frontend", message, stack });

    const issues = await db.select().from(bugIssuesTable);
    const issue = issues.find((i) => i.message.includes(marker));
    expect(issue).toBeTruthy();
    expect(issue!.message).toContain("[redacted-email]");
    expect(issue!.message).not.toContain("@example.com");
    expect(issue!.occurrenceCount).toBe(1);

    const occurrences = await db.select().from(bugOccurrencesTable).where(eq(bugOccurrencesTable.issueId, issue!.id));
    expect(occurrences).toHaveLength(1);
    expect(occurrences[0]!.stack).not.toBeNull();
  });

  it("groups a repeat occurrence into the same issue and increments occurrenceCount instead of creating a duplicate", async () => {
    const marker = safeMarker();
    const message = `Distinctive crash ${marker}`;
    const stack = "Error\n    at renderList (List.tsx:5:1)";

    await recordBugReport({ source: "frontend", message, stack });
    await recordBugReport({ source: "frontend", message, stack });
    await recordBugReport({ source: "frontend", message, stack });

    const fingerprint = fingerprintFor("frontend", message, stack);
    const issue = await issueFor(fingerprint);
    expect(issue!.occurrenceCount).toBe(3);

    const occurrences = await db.select().from(bugOccurrencesTable).where(eq(bugOccurrencesTable.issueId, issue!.id));
    expect(occurrences).toHaveLength(3);
  });

  it("stops storing detailed occurrence rows past MAX_STORED_OCCURRENCES while occurrenceCount keeps counting", async () => {
    const marker = safeMarker();
    const message = `Hot loop crash ${marker}`;

    for (let i = 0; i < MAX_STORED_OCCURRENCES + 5; i++) {
      await recordBugReport({ source: "frontend", message, stack: "Error\n    at loop (x.ts:1:1)" });
    }

    const fingerprint = fingerprintFor("frontend", message, "Error\n    at loop (x.ts:1:1)");
    const issue = await issueFor(fingerprint);
    expect(issue!.occurrenceCount).toBe(MAX_STORED_OCCURRENCES + 5);

    const occurrences = await db.select().from(bugOccurrencesTable).where(eq(bugOccurrencesTable.issueId, issue!.id));
    expect(occurrences).toHaveLength(MAX_STORED_OCCURRENCES);
  });

  it("never throws even when given an empty message", async () => {
    await expect(recordBugReport({ source: "backend", message: "" })).resolves.toBeUndefined();
  });
});
