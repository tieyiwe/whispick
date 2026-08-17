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

export async function ensureUser(clerkId: string, req: any): Promise<User> {
  const existing = await db.select().from(usersTable).where(eq(usersTable.clerkId, clerkId)).then(r => r[0]);
  if (existing) {
    void db.update(usersTable).set({ lastSeenAt: new Date() }).where(eq(usersTable.id, existing.id));

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
  // control. A previous version of this function fell back to a fabricated
  // `${clerkId}@blindwhisper.com` placeholder whenever that claim was
  // missing, which silently stored Clerk's own internal user id (a long
  // opaque string) as every new user's "email" instead of their real one.
  let email: string | null = (sessionClaims.email as string) ?? null;
  let fullName = (sessionClaims.name as string) ?? null;
  let phone = (sessionClaims.phone as string) ?? null;
  try {
    const clerkUser = await clerkClient.users.getUser(clerkId);
    const primaryEmail = clerkUser.emailAddresses.find((e) => e.id === clerkUser.primaryEmailAddressId);
    email = primaryEmail?.emailAddress ?? clerkUser.emailAddresses[0]?.emailAddress ?? email;
    fullName = [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(" ") || fullName;
    const primaryPhone = clerkUser.phoneNumbers.find((p) => p.id === clerkUser.primaryPhoneNumberId);
    phone = primaryPhone?.phoneNumber ?? clerkUser.phoneNumbers[0]?.phoneNumber ?? phone;
  } catch (err) {
    logger.error({ err, clerkId }, "Failed to fetch user profile from Clerk; falling back to session claims");
  }
  // Absolute last resort — should be effectively unreachable now that the
  // Clerk API call above is the primary source, but a real, guaranteed
  // non-null value is still required for the NOT NULL email column.
  email = email ?? `${clerkId}@blindwhisper.com`;
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
