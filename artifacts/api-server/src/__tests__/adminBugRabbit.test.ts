import { describe, it, expect } from "vitest";
import { randomUUID } from "crypto";
import request from "supertest";
import app from "../app";
import { TEST_USER_HEADER, clerkGetUserMock } from "./setup";
import { adminHeaders, collaboratorHeaders } from "./adminTestUtils";
import { db, adminAuditLogTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { recordBugReport } from "../lib/bugRabbit";

const OWNER_CLERK_ID = "clerk_admin_bugrabbit_owner";
const OWNER_EMAIL = `${OWNER_CLERK_ID}@blindwhisper.com`;

function asUser(clerkId: string) {
  return { [TEST_USER_HEADER]: clerkId };
}

async function asOwner() {
  return adminHeaders(OWNER_CLERK_ID, OWNER_EMAIL);
}

async function signInWithEmail(clerkId: string, email: string) {
  clerkGetUserMock.mockImplementation(async (id: string) =>
    id === clerkId
      ? ({ twoFactorEnabled: true, emailAddresses: [{ id: "e1", emailAddress: email }], primaryEmailAddressId: "e1", phoneNumbers: [] } as any)
      : ({ twoFactorEnabled: true } as any),
  );
  const res = await request(app).get("/api/user/profile").set(asUser(clerkId));
  return res.body;
}

async function makeIssue(message: string) {
  await recordBugReport({ source: "frontend", message, stack: "Error\n    at x (a.ts:1:1)" });
}

// Digit-free — see bugRabbit.test.ts's own safeMarker() for why: a plain
// randomUUID() sometimes contains a long enough all-digit hex segment to
// trip piiScrub's phone-number pattern, which would corrupt the message
// this file searches for by substring.
function safeMarker(): string {
  return randomUUID().replace(/[0-9]/g, "z");
}

describe("Admin BugRabbit", () => {
  it("requires admin auth", async () => {
    const res = await request(app).get("/api/admin/bug-rabbit/issues");
    expect(res.status).toBe(401);
  });

  it("requires the 'bugrabbit' permission specifically", async () => {
    const owner = await asOwner();
    const collabEmail = `bugrabbit_denied_${safeMarker()}@example.com`;
    const collabClerkId = `clerk_bugrabbit_denied_${safeMarker()}`;
    await signInWithEmail(collabClerkId, collabEmail);

    const grant = await request(app)
      .post("/api/admin/access/grants")
      .set(owner)
      .send({ email: collabEmail, roleTitle: "No BugRabbit", permissions: ["notifications"] });
    expect(grant.status).toBe(201);

    await signInWithEmail(collabClerkId, collabEmail);
    const collab = await collaboratorHeaders(collabClerkId);

    const res = await request(app).get("/api/admin/bug-rabbit/issues").set(collab);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("admin_permission_required");
    expect(res.body.permission).toBe("bugrabbit");
  });

  // Regression for the unscoped-router.use() footgun documented across the
  // other admin routers (see adminTextWhisps.test.ts's own version of this
  // test): adminBugRabbit.ts is mounted at its own distinct
  // "/admin/bug-rabbit" prefix specifically so its requireAdmin/
  // requirePermission("bugrabbit") chain can never leak onto unrelated
  // /admin/* requests, and a collaborator holding "bugrabbit" alone must
  // stay unable to reach a genuinely different admin area.
  it("a collaborator holding only 'bugrabbit' can use BugRabbit but not an unrelated admin area", async () => {
    const owner = await asOwner();
    const collabEmail = `bugrabbit_only_${safeMarker()}@example.com`;
    const collabClerkId = `clerk_bugrabbit_only_${safeMarker()}`;
    await signInWithEmail(collabClerkId, collabEmail);

    const grant = await request(app)
      .post("/api/admin/access/grants")
      .set(owner)
      .send({ email: collabEmail, roleTitle: "BugRabbit-only", permissions: ["bugrabbit"] });
    expect(grant.status).toBe(201);

    await signInWithEmail(collabClerkId, collabEmail);
    const collab = await collaboratorHeaders(collabClerkId);

    const listRes = await request(app).get("/api/admin/bug-rabbit/issues").set(collab);
    expect(listRes.status).toBe(200);

    const projectsRes = await request(app).get("/api/admin/projects").set(collab);
    expect(projectsRes.status).toBe(403);
    expect(projectsRes.body.permission).toBe("projects");
  });

  it("lists an issue, fetches its detail with occurrences, resolves it, and can reopen it", async () => {
    const owner = await asOwner();
    const marker = safeMarker();
    const message = `Admin-flow crash ${marker}`;
    await makeIssue(message);

    const list = await request(app).get("/api/admin/bug-rabbit/issues").set(owner).query({ status: "unresolved" });
    expect(list.status).toBe(200);
    const found = list.body.items.find((i: any) => i.message.includes(marker));
    expect(found).toBeTruthy();
    expect(found.occurrenceCount).toBe(1);
    expect(found.resolved).toBe(false);

    const detail = await request(app).get(`/api/admin/bug-rabbit/issues/${found.id}`).set(owner);
    expect(detail.status).toBe(200);
    expect(detail.body.issue.id).toBe(found.id);
    expect(detail.body.occurrences).toHaveLength(1);
    expect(detail.body.occurrences[0].stack).toContain("at x (a.ts:1:1)");

    const resolve = await request(app).patch(`/api/admin/bug-rabbit/issues/${found.id}`).set(owner).send({ resolved: true });
    expect(resolve.status).toBe(200);
    expect(resolve.body.resolved).toBe(true);
    expect(resolve.body.resolvedAt).toBeTruthy();
    expect(resolve.body.resolvedByAdminId).toBeTruthy();

    const auditRows = await db.select().from(adminAuditLogTable).where(eq(adminAuditLogTable.targetId, found.id));
    expect(auditRows.some((r) => r.action === "bug_issue.resolve")).toBe(true);

    // Resolved by default drops out of the "unresolved" view...
    const afterResolveList = await request(app).get("/api/admin/bug-rabbit/issues").set(owner).query({ status: "unresolved" });
    expect(afterResolveList.body.items.some((i: any) => i.id === found.id)).toBe(false);
    // ...but is still reachable under "resolved".
    const resolvedList = await request(app).get("/api/admin/bug-rabbit/issues").set(owner).query({ status: "resolved" });
    expect(resolvedList.body.items.some((i: any) => i.id === found.id)).toBe(true);

    const reopen = await request(app).patch(`/api/admin/bug-rabbit/issues/${found.id}`).set(owner).send({ resolved: false });
    expect(reopen.status).toBe(200);
    expect(reopen.body.resolved).toBe(false);
    expect(reopen.body.resolvedAt).toBeNull();

    const auditRowsAfterReopen = await db.select().from(adminAuditLogTable).where(eq(adminAuditLogTable.targetId, found.id));
    expect(auditRowsAfterReopen.some((r) => r.action === "bug_issue.reopen")).toBe(true);
  });

  it("frequency sort surfaces the highest-occurrence issue first", async () => {
    const owner = await asOwner();
    const markerLow = safeMarker();
    const markerHigh = safeMarker();
    await makeIssue(`Low-frequency ${markerLow}`);
    for (let i = 0; i < 3; i++) await makeIssue(`High-frequency ${markerHigh}`);

    const res = await request(app).get("/api/admin/bug-rabbit/issues").set(owner).query({ status: "all", sort: "frequency", pageSize: 100 });
    const items = res.body.items as any[];
    const highIdx = items.findIndex((i) => i.message.includes(markerHigh));
    const lowIdx = items.findIndex((i) => i.message.includes(markerLow));
    expect(highIdx).toBeGreaterThanOrEqual(0);
    expect(lowIdx).toBeGreaterThanOrEqual(0);
    expect(highIdx).toBeLessThan(lowIdx);
  });

  it("404s on an unknown issue id", async () => {
    const owner = await asOwner();
    const res = await request(app).get(`/api/admin/bug-rabbit/issues/${safeMarker()}`).set(owner);
    expect(res.status).toBe(404);
  });
});
