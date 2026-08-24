import { db, usersTable, type User } from "@workspace/db";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";

// A reserved account content-posting agents (lib/debateAgent.ts,
// lib/circleContentAgent.ts) author their posts under, instead of any real
// admin's own account — an admin configuring "post 3 topics a day" shouldn't
// mean every topic looks (in the database, to any future feature that reads
// authorId/senderId) like something THAT PERSON personally wrote. Never a
// real Clerk-backed login: clerkId is a synthetic, unguessable marker no
// real Clerk webhook/session could ever produce, so ensureUser's normal
// lookup-by-clerkId path can never collide with or return this row for an
// actual signed-in request.
const SYSTEM_AGENT_CLERK_ID = "system:content-agent";
const SYSTEM_AGENT_EMAIL = "content-agent@internal.blindwhisper.app";

let cachedId: string | null = null;

export async function ensureSystemAgentUser(): Promise<User> {
  if (cachedId) {
    const cached = await db.select().from(usersTable).where(eq(usersTable.id, cachedId)).then((r) => r[0]);
    if (cached) return cached;
    cachedId = null;
  }

  const existing = await db.select().from(usersTable).where(eq(usersTable.clerkId, SYSTEM_AGENT_CLERK_ID)).then((r) => r[0]);
  if (existing) {
    cachedId = existing.id;
    return existing;
  }

  const id = randomUUID();
  await db.insert(usersTable).values({
    id,
    clerkId: SYSTEM_AGENT_CLERK_ID,
    email: SYSTEM_AGENT_EMAIL,
    fullName: "Blind Whisper",
    plan: "free",
    boostCredits: 0,
    whisperLinksUsed: 0,
    role: "user",
  });

  cachedId = id;
  return db.select().from(usersTable).where(eq(usersTable.id, id)).then((r) => r[0]!);
}
