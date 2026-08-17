import { pgTable, text, integer, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const creditTransactionsTable = pgTable("credit_transactions", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  type: text("type").notNull(), // 'purchase' | 'spend' | 'refund' | 'plan_grant'
  amount: integer("amount").notNull(),
  whispId: text("whisp_id"),
  // The Stripe checkout session id for purchase/plan_grant rows — doubles as
  // an idempotency key so a retried webhook event can't double-credit.
  stripePaymentIntentId: text("stripe_payment_intent_id").unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("credit_transactions_user_id_idx").on(table.userId),
]);

export const insertCreditTransactionSchema = createInsertSchema(creditTransactionsTable).omit({ createdAt: true });
export type InsertCreditTransaction = z.infer<typeof insertCreditTransactionSchema>;
export type CreditTransaction = typeof creditTransactionsTable.$inferSelect;
