import { db } from "@workspace/db";
import { usersTable, adminGrantsTable, type User } from "@workspace/db";
import { eq } from "drizzle-orm";
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

function requestIp(req: any): string | undefined {
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

// The one place profile facts are pulled from Clerk's API — shared by the
// create path and the self-heal below. Every field is best-effort: a null
// just means Clerk didn't have it (or the call failed, which the caller
// sees as all-null). The optional chaining matters: a misconfigured
// secret key or an API shape surprise has returned records without an
// emailAddresses array in production, and `.find` on undefined was the
// exact TypeError that silently pushed signups onto the placeholder path.
export async function fetchClerkProfile(
  clerkId: string,
): Promise<{ email: string | null; fullName: string | null; phone: string | null; twoFactorEnabled: boolean | null }> {
  try {
    const clerkUser = await clerkClient.users.getUser(clerkId);
    const primaryEmail = clerkUser.emailAddresses?.find((e) => e.id === clerkUser.primaryEmailAddressId);
    const email = primaryEmail?.emailAddress ?? clerkUser.emailAddresses?.[0]?.emailAddress ?? null;
    const fullName = [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(" ") || null;
    const primaryPhone = clerkUser.phoneNumbers?.find((p) => p.id === clerkUser.primaryPhoneNumberId);
    const phone = primaryPhone?.phoneNumber ?? clerkUser.phoneNumbers?.[0]?.phoneNumber ?? null;
    const twoFactorEnabled = typeof clerkUser.twoFactorEnabled === "boolean" ? clerkUser.twoFactorEnabled : null;
    return { email, fullName, phone, twoFactorEnabled };
  } catch (err) {
    logger.error({ err, clerkId }, "Failed to fetch user profile from Clerk");
    return { email: null, fullName: null, phone: null, twoFactorEnabled: null };
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

// A standing collaborator invite (admin_grants.ts) attaches the moment a
// user with the invited email exists: promote to the admin role and link
// the grant row. Runs only for non-admin users with a real (non-
// placeholder) email — one indexed lookup on the hot path, same cost class
// as the ADMIN_EMAILS bootstrap check.
async function maybeApplyAdminGrant(user: User): Promise<User> {
  if (user.role === "admin" || isPlaceholderEmail(user.email, user.clerkId)) return user;
  const grant = await db
    .select()
    .from(adminGrantsTable)
    .where(eq(adminGrantsTable.email, user.email.toLowerCase()))
    .then(r => r[0]);
  if (!grant) return user;
  await db.update(usersTable).set({ role: "admin" }).where(eq(usersTable.id, user.id));
  if (!grant.userId) {
    await db.update(adminGrantsTable).set({ userId: user.id, linkedAt: new Date() }).where(eq(adminGrantsTable.id, grant.id));
  }
  logger.info({ userId: user.id, grantId: grant.id, roleTitle: grant.roleTitle }, "Linked admin grant and promoted collaborator");
  return { ...user, role: "admin" };
}

export async function ensureUser(clerkId: string, req: any): Promise<User> {
  let existing = await db.select().from(usersTable).where(eq(usersTable.clerkId, clerkId)).then(r => r[0]);
  if (existing) {
    void db.update(usersTable).set({ lastSeenAt: new Date() }).where(eq(usersTable.id, existing.id));

    // Self-heal a placeholder email left behind by a failed signup-day
    // Clerk fetch (see fetchClerkProfile). Without this, that one failure
    // was permanent: the create path below is the only place the real
    // email was ever fetched, so affected users kept an undeliverable
    // notification address forever — and could never match an
    // ADMIN_EMAILS entry.
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
        }
      }
    }

    maybeSyncTwoFactorStatus(existing);

    if (existing.role !== "admin" && isBootstrapAdminEmail(existing.email)) {
      await db.update(usersTable).set({ role: "admin" }).where(eq(usersTable.id, existing.id));
      return { ...existing, role: "admin" };
    }
    return maybeApplyAdminGrant(existing);
  }

  const id = randomUUID();
  const sessionClaims = (req.auth?.sessionClaims as Record<string, unknown>) ?? {};

  // Fetch the real user record from Clerk's own API rather than relying on
  // the session JWT carrying an email/name/phone claim — those only appear
  // if this app's Clerk instance has a custom JWT template configured for
  // them in the Clerk Dashboard, which is fragile and outside this code's
  // control. Session claims remain the fallback when the API call fails;
  // the placeholder below is the last resort, and the self-heal above now
  // repairs it on a later sign-in instead of it sticking forever.
  const clerkProfile = await fetchClerkProfile(clerkId);
  const email = clerkProfile.email ?? (sessionClaims.email as string) ?? `${clerkId}@blindwhisper.com`;
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
  return maybeApplyAdminGrant(created);
}
