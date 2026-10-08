import { db } from "@workspace/db";
import { usersTable, adminGrantsTable, type User } from "@workspace/db";
import { and, eq, isNull } from "drizzle-orm";
import { randomUUID } from "crypto";
import { clerkClient } from "@clerk/express";
import { lookupGeoIp } from "./geoip";
import { logger } from "./logger";
import { notifyAdminsOfNewSignup } from "./adminNotify";

// App owner(s) bootstrap: comma-separated emails that are auto-promoted to
// the admin role. This is the only way to create the first admin — there's
// no UI for it, since an admin panel obviously can't be the thing that grants
// its own first access.
export function isBootstrapAdminEmail(email: string): boolean {
  const list = process.env.ADMIN_EMAILS;
  if (!list) return false;
  return list
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
    .includes(email.toLowerCase());
}

// Exported for lib/visitorTracking.ts, which needs the exact same "what IP
// is this request actually from" logic for its own geo lookup — one
// definition, not two copies that could drift.
export function requestIp(req: any): string | undefined {
  return req.ip ?? req.socket?.remoteAddress;
}

// True when the stored "email" is one of the fabricated fallbacks this
// function has ever written (`${clerkId}@blindwhisper.com` today,
// `${clerkId}@whispr.app` in the pre-rename era) rather than an address a
// human can actually receive mail at. Matching on the clerkId prefix covers
// both domains without a hardcoded list.
export function isPlaceholderEmail(email: string, clerkId: string): boolean {
  return email.startsWith(`${clerkId}@`);
}

export type ClerkProfile = {
  email: string | null;
  fullName: string | null;
  phone: string | null;
  twoFactorEnabled: boolean | null;
  // Lowercased VERIFIED addresses on the account; null when Clerk couldn't
  // answer (call failed / no emailAddresses array) — distinct from [].
  verifiedEmails: string[] | null;
};

// The one place profile facts are pulled from Clerk's API — shared by the
// create path and the self-heal below. Every field is best-effort: a null
// just means Clerk didn't have it (or the call failed, which the caller
// sees as all-null). The optional chaining matters: a misconfigured
// secret key or an API shape surprise has returned records without an
// emailAddresses array in production, and `.find` on undefined was the
// exact TypeError that silently pushed signups onto the placeholder path.
//
// SECURITY: only a VERIFIED address is ever returned as `email`. The stored
// email drives ADMIN_EMAILS ownership, staff-grant linking and whisp
// recipient matching, so an address someone merely typed into their Clerk
// account (without proving they own it) must never become it.
export async function fetchClerkProfile(clerkId: string): Promise<ClerkProfile> {
  try {
    const clerkUser = await clerkClient.users.getUser(clerkId);
    const addresses = Array.isArray(clerkUser.emailAddresses) ? clerkUser.emailAddresses : null;
    const verified = addresses?.filter((e) => e?.verification?.status === "verified" && !!e.emailAddress) ?? null;
    const primaryEmail = verified?.find((e) => e.id === clerkUser.primaryEmailAddressId);
    const email = (primaryEmail ?? verified?.[0])?.emailAddress ?? null;
    const fullName = [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(" ") || null;
    const primaryPhone = clerkUser.phoneNumbers?.find((p) => p.id === clerkUser.primaryPhoneNumberId);
    const phone = primaryPhone?.phoneNumber ?? clerkUser.phoneNumbers?.[0]?.phoneNumber ?? null;
    const twoFactorEnabled = typeof clerkUser.twoFactorEnabled === "boolean" ? clerkUser.twoFactorEnabled : null;
    const verifiedEmails = verified ? verified.map((e) => e.emailAddress.toLowerCase()) : null;
    return { email, fullName, phone, twoFactorEnabled, verifiedEmails };
  } catch (err) {
    logger.error({ err, clerkId }, "Failed to fetch user profile from Clerk");
    return { email: null, fullName: null, phone: null, twoFactorEnabled: null, verifiedEmails: null };
  }
}

// Self-heal retry throttle: ensureUser runs on every authenticated request,
// and when Clerk's API is the thing that's broken, retrying the fetch per
// request would add a failing network round-trip to every call. Once per
// this interval per user is plenty — the point is that a signup-day outage
// stops being a permanent wrong email, not that it heals within seconds.
const PROFILE_HEAL_RETRY_MS = 10 * 60 * 1000;
const lastHealAttempt = new Map<string, number>();

// A separate, much slower throttle for the admin compliance dashboard's
// users.twoFactorEnabled mirror (see its schema comment) — unlike a
// placeholder email, a stale 2FA flag isn't urgent, so this doesn't need the
// email-heal cadence above. Fire-and-forget: never adds latency to the
// request it happens to piggyback on.
const MFA_SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000;
const lastMfaSync = new Map<string, number>();
function maybeSyncTwoFactorStatus(user: User): void {
  const last = lastMfaSync.get(user.clerkId) ?? 0;
  if (Date.now() - last <= MFA_SYNC_INTERVAL_MS) return;
  lastMfaSync.set(user.clerkId, Date.now());
  void fetchClerkProfile(user.clerkId)
    .then((profile) => {
      if (profile.twoFactorEnabled === null || profile.twoFactorEnabled === user.twoFactorEnabled) return;
      return db.update(usersTable).set({ twoFactorEnabled: profile.twoFactorEnabled }).where(eq(usersTable.id, user.id));
    })
    .catch((err) => logger.warn({ err, userId: user.id }, "2FA status sync failed"));
}

// Privileged accounts (admins, and anyone whose stored email is an
// ADMIN_EMAILS owner address) periodically re-confirm with Clerk that the
// stored email is still a VERIFIED address on their account. Covers rows
// written before fetchClerkProfile required verification, and an owner/
// invitee address later removed from the account. Per-instance throttle —
// a Clerk round-trip at most once per interval per privileged user.
const PRIVILEGED_EMAIL_RECHECK_MS = 10 * 60 * 1000;
const lastPrivilegedRecheck = new Map<string, number>();

async function revalidatePrivilegedEmail(user: User): Promise<User> {
  // A placeholder is derived from the authenticated clerkId itself, so it
  // can't belong to anyone else — nothing to re-verify.
  if (isPlaceholderEmail(user.email, user.clerkId)) return user;
  if (user.role !== "admin" && !isBootstrapAdminEmail(user.email)) return user;
  const last = lastPrivilegedRecheck.get(user.clerkId) ?? 0;
  if (Date.now() - last <= PRIVILEGED_EMAIL_RECHECK_MS) return user;
  lastPrivilegedRecheck.set(user.clerkId, Date.now());

  const profile = await fetchClerkProfile(user.clerkId);
  // Fail SAFE: only a definite answer from Clerk can strip access. An
  // outage or odd API shape must never lock the real owner out.
  if (!profile.verifiedEmails) {
    logger.warn({ userId: user.id }, "Privileged email re-check skipped: Clerk profile unavailable");
    return user;
  }
  if (profile.verifiedEmails.includes(user.email.toLowerCase())) return user;

  // Launch-day escape hatch: ADMIN_EMAIL_RECHECK=log-only reports the
  // mismatch without acting on it (e.g. if the owner's address turns out to
  // be unverified in Clerk and needs fixing there first).
  if (process.env.ADMIN_EMAIL_RECHECK === "log-only") {
    logger.error({ userId: user.id, role: user.role }, "SECURITY: privileged account's stored email is not a verified Clerk address (log-only mode, not enforced)");
    return user;
  }

  // The stored address is NOT a verified address on this Clerk account any
  // more: drop it (and any owner/staff access it conferred), falling back
  // to the account's current verified email or the placeholder.
  const placeholder = `${user.clerkId}@blindwhisper.com`;
  let replacement = profile.email ?? placeholder;
  if (replacement !== placeholder) {
    const taken = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.email, replacement)).then((r) => r[0]);
    if (taken && taken.id !== user.id) replacement = placeholder;
  }
  const role = isBootstrapAdminEmail(replacement) ? "admin" : "user";
  await db.update(usersTable).set({ email: replacement, role }).where(eq(usersTable.id, user.id));
  // Unlink (not delete) a grant this account had claimed, so the rightful
  // invitee can still claim it once they sign in with the verified address.
  await db
    .update(adminGrantsTable)
    .set({ userId: null, linkedAt: null })
    .where(eq(adminGrantsTable.userId, user.id));
  logger.error(
    { userId: user.id, clerkId: user.clerkId, previousRole: user.role, newRole: role },
    "SECURITY: stored email is no longer a verified Clerk address — privileged access removed",
  );
  return { ...user, email: replacement, role };
}

// Whether the stored email is a verified address on the Clerk account right
// now. null = Clerk couldn't answer (caller decides how to fail).
async function storedEmailVerifiedInClerk(user: User): Promise<boolean | null> {
  const profile = await fetchClerkProfile(user.clerkId);
  if (!profile.verifiedEmails) return null;
  return profile.verifiedEmails.includes(user.email.toLowerCase());
}

// A standing collaborator invite (admin_grants.ts) attaches the moment a
// user with the invited email exists: promote to the admin role and link
// the grant row. Runs only for non-admin users with a real (non-
// placeholder) email — one indexed lookup on the hot path, same cost class
// as the ADMIN_EMAILS bootstrap check. `emailJustVerified` = the caller took
// the email from a verified Clerk address on this very request; otherwise
// it's re-confirmed with Clerk before promoting (rare: only when a pending
// grant actually matches).
async function maybeApplyAdminGrant(user: User, emailJustVerified: boolean): Promise<User> {
  if (user.role === "admin" || isPlaceholderEmail(user.email, user.clerkId)) return user;
  const grant = await db
    .select()
    .from(adminGrantsTable)
    .where(eq(adminGrantsTable.email, user.email.toLowerCase()))
    .then(r => r[0]);
  if (!grant) return user;
  // A grant already claimed by a different account is never re-pointed.
  if (grant.userId && grant.userId !== user.id) {
    logger.warn({ userId: user.id, grantId: grant.id }, "Admin grant already linked to another account — not applying");
    return user;
  }
  if (!emailJustVerified) {
    const last = lastPrivilegedRecheck.get(user.clerkId) ?? 0;
    if (Date.now() - last <= PRIVILEGED_EMAIL_RECHECK_MS) return user;
    lastPrivilegedRecheck.set(user.clerkId, Date.now());
    if ((await storedEmailVerifiedInClerk(user)) !== true) {
      logger.warn({ userId: user.id, grantId: grant.id }, "Admin grant not applied: stored email not confirmed verified in Clerk");
      return user;
    }
  }
  await db.update(usersTable).set({ role: "admin" }).where(eq(usersTable.id, user.id));
  if (!grant.userId) {
    await db
      .update(adminGrantsTable)
      .set({ userId: user.id, linkedAt: new Date() })
      .where(and(eq(adminGrantsTable.id, grant.id), isNull(adminGrantsTable.userId)));
  }
  logger.info({ userId: user.id, grantId: grant.id, roleTitle: grant.roleTitle }, "Linked admin grant and promoted collaborator");
  return { ...user, role: "admin" };
}

export async function ensureUser(clerkId: string, req: any): Promise<User> {
  let existing = await db.select().from(usersTable).where(eq(usersTable.clerkId, clerkId)).then(r => r[0]);
  if (existing) {
    // Fire-and-forget so it never delays the request, but log a failure —
    // if this silently stops working (e.g. a schema drift where the
    // production DB is missing a column this update's row touches, or the
    // users table itself is behind), "last seen" and the whole
    // online/active-now view freeze with nothing to explain why.
    void db
      .update(usersTable)
      .set({ lastSeenAt: new Date() })
      .where(eq(usersTable.id, existing.id))
      .catch((err) => logger.warn({ err, userId: existing.id }, "lastSeenAt update failed"));

    // Self-heal a placeholder email left behind by a failed signup-day
    // Clerk fetch (see fetchClerkProfile). Without this, that one failure
    // was permanent: the create path below is the only place the real
    // email was ever fetched, so affected users kept an undeliverable
    // notification address forever — and could never match an
    // ADMIN_EMAILS entry.
    let emailJustVerified = false;
    if (isPlaceholderEmail(existing.email, clerkId)) {
      const last = lastHealAttempt.get(clerkId) ?? 0;
      if (Date.now() - last > PROFILE_HEAL_RETRY_MS) {
        lastHealAttempt.set(clerkId, Date.now());
        const profile = await fetchClerkProfile(clerkId);
        if (profile.email) {
          // Email always wins (the stored one is known-fabricated); name and
          // phone only fill gaps — both are user-editable/verifiable in-app,
          // and a heal pass shouldn't clobber what someone set themselves.
          await db
            .update(usersTable)
            .set({
              email: profile.email,
              ...(existing.fullName ? {} : { fullName: profile.fullName }),
              ...(existing.phone ? {} : { phone: profile.phone }),
            })
            .where(eq(usersTable.id, existing.id));
          logger.info({ userId: existing.id, clerkId }, "Healed placeholder email from Clerk profile");
          existing = await db.select().from(usersTable).where(eq(usersTable.id, existing.id)).then(r => r[0]!);
          emailJustVerified = true;
        }
      }
    }

    maybeSyncTwoFactorStatus(existing);

    if (emailJustVerified) lastPrivilegedRecheck.set(clerkId, Date.now());
    else existing = await revalidatePrivilegedEmail(existing);

    if (existing.role !== "admin" && isBootstrapAdminEmail(existing.email)) {
      await db.update(usersTable).set({ role: "admin" }).where(eq(usersTable.id, existing.id));
      return { ...existing, role: "admin" };
    }
    return maybeApplyAdminGrant(existing, emailJustVerified);
  }

  const id = randomUUID();
  const sessionClaims = (req.auth?.sessionClaims as Record<string, unknown>) ?? {};

  // Fetch the real user record from Clerk's own API rather than relying on
  // the session JWT carrying an email/name/phone claim — those only appear
  // if this app's Clerk instance has a custom JWT template configured for
  // them in the Clerk Dashboard, which is fragile and outside this code's
  // control. Name/phone claims remain the fallback when the API call fails;
  // an email claim is NOT used — a template claim can't tell us whether the
  // address was verified, and the stored email confers owner/staff access.
  // The placeholder is the last resort, and the self-heal above repairs it
  // on a later sign-in instead of it sticking forever.
  const clerkProfile = await fetchClerkProfile(clerkId);
  const email = clerkProfile.email ?? `${clerkId}@blindwhisper.com`;
  const fullName = clerkProfile.fullName ?? (sessionClaims.name as string) ?? null;
  const phone = clerkProfile.phone ?? (sessionClaims.phone as string) ?? null;
  const role = isBootstrapAdminEmail(email) ? "admin" : "user";

  await db.insert(usersTable).values({
    id,
    clerkId,
    email,
    fullName,
    phone,
    plan: "free",
    boostCredits: 0,
    whisperLinksUsed: 0,
    role,
    lastSeenAt: new Date(),
    twoFactorEnabled: clerkProfile.twoFactorEnabled,
  });

  const ip = requestIp(req);
  if (ip) {
    void lookupGeoIp(ip)
      .then((location) => {
        if (!location) return;
        return db.update(usersTable).set(location).where(eq(usersTable.id, id));
      })
      .catch((err) => logger.warn({ err, userId: id }, "Geo-IP lookup failed"));
  }

  // Fire-and-forget — an admin alert must never add latency to (or fail)
  // the request that's actually creating this account.
  void notifyAdminsOfNewSignup({ id, fullName, email });

  const created = await db.select().from(usersTable).where(eq(usersTable.clerkId, clerkId)).then(r => r[0]!);
  // Just verified against Clerk above — no re-check needed for a while.
  lastPrivilegedRecheck.set(clerkId, Date.now());
  return maybeApplyAdminGrant(created, !!clerkProfile.email);
}
