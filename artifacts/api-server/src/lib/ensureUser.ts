import { db } from "@workspace/db";
import { usersTable, type User } from "@workspace/db";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import { clerkClient } from "@clerk/express";
import { lookupGeoIp } from "./geoip";
import { logger } from "./logger";

// App owner(s) bootstrap: comma-separated emails that are auto-promoted to
// the admin role. This is the only way to create the first admin — there's
// no UI for it, since an admin panel obviously can't be the thing that grants
// its own first access.
function isBootstrapAdminEmail(email: string): boolean {
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
export async function fetchClerkProfile(clerkId: string): Promise<{ email: string | null; fullName: string | null; phone: string | null }> {
  try {
    const clerkUser = await clerkClient.users.getUser(clerkId);
    const primaryEmail = clerkUser.emailAddresses?.find((e) => e.id === clerkUser.primaryEmailAddressId);
    const email = primaryEmail?.emailAddress ?? clerkUser.emailAddresses?.[0]?.emailAddress ?? null;
    const fullName = [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(" ") || null;
    const primaryPhone = clerkUser.phoneNumbers?.find((p) => p.id === clerkUser.primaryPhoneNumberId);
    const phone = primaryPhone?.phoneNumber ?? clerkUser.phoneNumbers?.[0]?.phoneNumber ?? null;
    return { email, fullName, phone };
  } catch (err) {
    logger.error({ err, clerkId }, "Failed to fetch user profile from Clerk");
    return { email: null, fullName: null, phone: null };
  }
}

// Self-heal retry throttle: ensureUser runs on every authenticated request,
// and when Clerk's API is the thing that's broken, retrying the fetch per
// request would add a failing network round-trip to every call. Once per
// this interval per user is plenty — the point is that a signup-day outage
// stops being a permanent wrong email, not that it heals within seconds.
const PROFILE_HEAL_RETRY_MS = 10 * 60 * 1000;
const lastHealAttempt = new Map<string, number>();

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

    if (existing.role !== "admin" && isBootstrapAdminEmail(existing.email)) {
      await db.update(usersTable).set({ role: "admin" }).where(eq(usersTable.id, existing.id));
      return { ...existing, role: "admin" };
    }
    return existing;
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

  return db.select().from(usersTable).where(eq(usersTable.clerkId, clerkId)).then(r => r[0]!);
}
