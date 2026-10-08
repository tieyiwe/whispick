import { db, usersTable, policyVersionsTable, policyAcceptancesTable } from "@workspace/db";
import { and, eq, inArray, isNotNull, desc } from "drizzle-orm";
import { isPlaceholderEmail } from "./ensureUser";

export type ComplianceFlags = {
  emailVerified: boolean;
  phoneVerified: boolean;
  // null = never synced yet (see users.twoFactorEnabled's schema comment),
  // distinct from false ("synced, and it's off").
  mfaEnabled: boolean | null;
  policyUpToDate: boolean;
};

// The same "latest published version per docType" resolution
// routes/user.ts's GET /policy-status uses for one user, batched here for
// every user on one admin page at once rather than N queries.
async function latestPublishedPolicyIds(): Promise<string[]> {
  const published = await db
    .select({ id: policyVersionsTable.id, docType: policyVersionsTable.docType })
    .from(policyVersionsTable)
    .where(isNotNull(policyVersionsTable.publishedAt))
    .orderBy(desc(policyVersionsTable.publishedAt));
  const latestByDocType = new Map<string, string>();
  for (const v of published) {
    if (!latestByDocType.has(v.docType)) latestByDocType.set(v.docType, v.id);
  }
  return [...latestByDocType.values()];
}

// Batch compliance signals for the admin Users compliance dashboard. Never
// used for any access-control decision — purely a "does this person need a
// nudge" view.
export async function complianceFlagsFor(
  users: { id: string; clerkId: string; email: string; phoneVerifiedAt: Date | null; twoFactorEnabled: boolean | null }[],
): Promise<Record<string, ComplianceFlags>> {
  const latestPolicyIds = await latestPublishedPolicyIds();
  const acceptedByUser = new Map<string, Set<string>>();
  if (latestPolicyIds.length && users.length) {
    const acceptances = await db
      .select({ userId: policyAcceptancesTable.userId, policyVersionId: policyAcceptancesTable.policyVersionId })
      .from(policyAcceptancesTable)
      .where(and(inArray(policyAcceptancesTable.userId, users.map((u) => u.id)), inArray(policyAcceptancesTable.policyVersionId, latestPolicyIds)));
    for (const a of acceptances) {
      if (!acceptedByUser.has(a.userId)) acceptedByUser.set(a.userId, new Set());
      acceptedByUser.get(a.userId)!.add(a.policyVersionId);
    }
  }

  const result: Record<string, ComplianceFlags> = {};
  for (const u of users) {
    const accepted = acceptedByUser.get(u.id) ?? new Set();
    result[u.id] = {
      emailVerified: !isPlaceholderEmail(u.email, u.clerkId),
      phoneVerified: !!u.phoneVerifiedAt,
      mfaEnabled: u.twoFactorEnabled,
      policyUpToDate: latestPolicyIds.every((id) => accepted.has(id)),
    };
  }
  return result;
}

export type ComplianceFilter = "mfa_missing" | "policy_pending" | "email_unverified" | "phone_unverified";

// Applied AFTER the page's DB query returns (compliance isn't a plain column
// to filter in SQL — it's derived from a join plus a Clerk mirror) — fine at
// this scale, the admin Users list is already paginated to a small page size.
export function matchesComplianceFilter(flags: ComplianceFlags, filter: ComplianceFilter): boolean {
  switch (filter) {
    case "mfa_missing":
      return flags.mfaEnabled !== true;
    case "policy_pending":
      return !flags.policyUpToDate;
    case "email_unverified":
      return !flags.emailVerified;
    case "phone_unverified":
      return !flags.phoneVerified;
  }
}
