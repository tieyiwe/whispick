import { db } from "@workspace/db";
import { usersTable, type User } from "@workspace/db";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";
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
  const email = (sessionClaims.email as string) ?? `${clerkId}@blindwhisper.com`;
  const fullName = (sessionClaims.name as string) ?? null;
  const role = isBootstrapAdminEmail(email) ? "admin" : "user";

  await db.insert(usersTable).values({
    id,
    clerkId,
    email,
    fullName,
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
