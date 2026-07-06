import { Router } from "express";
import { getAuth } from "@clerk/express";
import { db } from "@workspace/db";
import { creditTransactionsTable, usersTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { randomUUID } from "crypto";

const router = Router();

function requireAuth(req: any, res: any, next: any) {
  const { userId } = getAuth(req);
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}

async function ensureUser(clerkId: string) {
  return await db.select().from(usersTable).where(eq(usersTable.clerkId, clerkId)).then(r => r[0]);
}

// GET /api/credits/transactions
router.get("/transactions", requireAuth, async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  const user = await ensureUser(userId!);

  if (!user) {
    res.json([]);
    return;
  }

  const transactions = await db
    .select()
    .from(creditTransactionsTable)
    .where(eq(creditTransactionsTable.userId, user.id))
    .orderBy(sql`${creditTransactionsTable.createdAt} DESC`);

  res.json(transactions);
});

export default router;
