import { getAuth } from "@clerk/express";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

// Deliberately untyped (matches every route's inferred param/response shape) —
// an explicit Request/Response annotation here forces Express to widen every
// route's params to the generic ParamsDictionary for the whole handler chain,
// which breaks each route's own `:id`-style param inference.
export async function requireAuth(req: any, res: any, next: any) {
  const { userId } = getAuth(req);
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  // Lightweight indexed lookup (not the full ensureUser insert-if-missing
  // path, which every route already calls right after this) — just enough to
  // enforce a ban. A user who doesn't exist yet is on their first request and
  // obviously isn't banned.
  const existing = await db
    .select({ banned: usersTable.banned })
    .from(usersTable)
    .where(eq(usersTable.clerkId, userId))
    .then((r) => r[0]);

  if (existing?.banned) {
    res.status(403).json({ error: "Your account has been suspended" });
    return;
  }

  next();
}

/**
 * The Clerk user id for the "unauthenticated" public routes (routes/
 * public.ts, the Debate Now thread routes) that still read the session to
 * grant signed-in perks — no anonymous comment/reply cap, video replies,
 * a persistent Whisperer handle, isPoster. Those routes can't use
 * requireAuth (anonymous callers are their main audience), so they called
 * getAuth() directly and never saw users.banned: a suspended account kept
 * every signed-in privilege there, e.g. unlimited comments under its
 * persistent handle, while every requireAuth route refused it.
 *
 * A banned account is treated exactly like a signed-out visitor here
 * (null) rather than rejected outright — it could sign out and post as
 * one anyway, so this removes the privileges without inventing a
 * different, probe-able response for suspended accounts.
 */
export async function activeClerkUserId(req: any): Promise<string | null> {
  const { userId } = getAuth(req);
  if (!userId) return null;
  const existing = await db
    .select({ banned: usersTable.banned })
    .from(usersTable)
    .where(eq(usersTable.clerkId, userId))
    .then((r) => r[0]);
  return existing?.banned ? null : userId;
}
