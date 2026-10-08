import { describe, it, expect } from "vitest";
import { randomUUID } from "crypto";
import request from "supertest";
import app from "../app";
import { db, bugIssuesTable, bugOccurrencesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { TEST_USER_HEADER } from "./setup";
import { fingerprintFor } from "../lib/bugRabbit";

function asUser(clerkId: string) {
  return { [TEST_USER_HEADER]: clerkId };
}

// Digit-free — see bugRabbit.test.ts's own safeMarker() for why: a plain
// randomUUID() sometimes contains a long enough all-digit hex segment to
// trip piiScrub's phone-number pattern, which would change the stored
// message and break the fingerprint this file recomputes from the raw one.
function safeMarker(): string {
  return randomUUID().replace(/[0-9]/g, "z");
}

describe("POST /api/public/bug-reports", () => {
  it("creates an issue from an anonymous (unauthenticated) report", async () => {
    const marker = safeMarker();
    const message = `Guest crash ${marker}`;
    const res = await request(app)
      .post("/api/public/bug-reports")
      .send({ message, stack: "Error\n    at render (App.tsx:1:1)", url: "/w/abc123?utm_source=x" });

    expect(res.status).toBe(204);

    const fingerprint = fingerprintFor("frontend", message, "Error\n    at render (App.tsx:1:1)");
    const issue = await db.select().from(bugIssuesTable).where(eq(bugIssuesTable.fingerprint, fingerprint)).then((r) => r[0]);
    expect(issue).toBeTruthy();
    expect(issue!.source).toBe("frontend");

    const occurrence = await db.select().from(bugOccurrencesTable).where(eq(bugOccurrencesTable.issueId, issue!.id)).then((r) => r[0]);
    // The query string (which could carry a token) is stripped before storage.
    expect(occurrence!.url).toBe("/w/abc123");
    expect(occurrence!.userId).toBeNull();
  });

  it("attributes the occurrence to the signed-in user when a session is present", async () => {
    const clerkId = `clerk_bugreport_${randomUUID()}`;
    const profile = await request(app).get("/api/user/profile").set(asUser(clerkId));
    const marker = safeMarker();
    const message = `Signed-in crash ${marker}`;

    const res = await request(app)
      .post("/api/public/bug-reports")
      .set(asUser(clerkId))
      .send({ message });
    expect(res.status).toBe(204);

    const fingerprint = fingerprintFor("frontend", message, undefined);
    const issue = await db.select().from(bugIssuesTable).where(eq(bugIssuesTable.fingerprint, fingerprint)).then((r) => r[0]);
    const occurrence = await db.select().from(bugOccurrencesTable).where(eq(bugOccurrencesTable.issueId, issue!.id)).then((r) => r[0]);
    expect(occurrence!.userId).toBe(profile.body.id);
  });

  it("rejects a payload with no message", async () => {
    const res = await request(app).post("/api/public/bug-reports").send({ stack: "Error" });
    expect(res.status).toBe(400);
  });

  it("rejects an oversized message", async () => {
    const res = await request(app).post("/api/public/bug-reports").send({ message: "x".repeat(3000) });
    expect(res.status).toBe(400);
  });
});
