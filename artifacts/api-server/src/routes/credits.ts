import { Router } from "express";
import { getAuth } from "@clerk/express";
import { db } from "@workspace/db";
import { creditTransactionsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { requireAuth } from "../lib/auth";
import { ensureUser } from "../lib/ensureUser";

const router = Router();

// GET /api/credits/transactions
router.get("/transactions", requireAuth, async (req, res): Promise<void> => {
  const { userId } = getAuth(req);
  const user = await ensureUser(userId!, req);

  const transactions = await db
    .select()
    .from(creditTransactionsTable)
    .where(eq(creditTransactionsTable.userId, user.id))
    .orderBy(sql`${creditTransactionsTable.createdAt} DESC`);

  res.json(transactions);
});

export default router;
