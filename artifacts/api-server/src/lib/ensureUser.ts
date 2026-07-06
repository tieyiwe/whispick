import { db } from "@workspace/db";
import { usersTable, type User } from "@workspace/db";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";

export async function ensureUser(clerkId: string, req: any): Promise<User> {
  const existing = await db.select().from(usersTable).where(eq(usersTable.clerkId, clerkId)).then(r => r[0]);
  if (existing) return existing;

  const id = randomUUID();
  const sessionClaims = (req.auth?.sessionClaims as Record<string, unknown>) ?? {};
  const email = (sessionClaims.email as string) ?? `${clerkId}@whispick.app`;
  const fullName = (sessionClaims.name as string) ?? null;

  await db.insert(usersTable).values({
    id,
    clerkId,
    email,
    fullName,
    plan: "free",
    boostCredits: 0,
    whisperLinksUsed: 0,
  });

  return db.select().from(usersTable).where(eq(usersTable.clerkId, clerkId)).then(r => r[0]!);
}
