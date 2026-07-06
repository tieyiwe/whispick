import { Router } from "express";
import express from "express";
import { getAuth } from "@clerk/express";
import { db } from "@workspace/db";
import { usersTable, creditTransactionsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { randomUUID } from "crypto";
import { z } from "zod";
import { requireAuth } from "../lib/auth";
import { ensureUser } from "../lib/ensureUser";
import { getPublicAppUrl } from "../lib/publicUrl";
import { stripe, CREDIT_PACKS, PLAN_PRICES, type CreditPackId, type PlanId } from "../lib/stripe";
import { PLAN_LIMITS } from "../lib/plans";
import { logger } from "../lib/logger";

const router = Router();

const checkoutSchema = z.object({
  kind: z.enum(["credit_pack", "plan"]),
  id: z.string().min(1),
});

// POST /api/billing/checkout
router.post("/checkout", requireAuth, async (req, res): Promise<void> => {
  if (!stripe) {
    res.status(503).json({ error: "Billing is not configured. Set STRIPE_SECRET_KEY to enable payments." });
    return;
  }

  const { userId } = getAuth(req);
  const user = await ensureUser(userId!, req);

  const parsed = checkoutSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { kind, id } = parsed.data;
  const appUrl = getPublicAppUrl(req);

  let customerId = user.stripeCustomerId ?? undefined;
  if (!customerId) {
    const customer = await stripe.customers.create({ email: user.email, metadata: { userId: user.id } });
    customerId = customer.id;
    await db.update(usersTable).set({ stripeCustomerId: customerId }).where(eq(usersTable.id, user.id));
  }

  if (kind === "credit_pack") {
    const pack = CREDIT_PACKS[id as CreditPackId];
    if (!pack) {
      res.status(400).json({ error: "Unknown credit pack" });
      return;
    }

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer: customerId,
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: { name: `${pack.label} — Ghost Boost credits` },
            unit_amount: pack.priceUsdCents,
          },
          quantity: 1,
        },
      ],
      metadata: { userId: user.id, kind: "credit_pack", packId: id },
      success_url: `${appUrl}/credits?checkout=success`,
      cancel_url: `${appUrl}/credits?checkout=cancelled`,
    });

    res.json({ url: session.url });
    return;
  }

  const plan = PLAN_PRICES[id as PlanId];
  if (!plan) {
    res.status(400).json({ error: "Unknown plan" });
    return;
  }

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: [
      {
        price_data: {
          currency: "usd",
          product_data: { name: `Whispick ${plan.label} plan` },
          unit_amount: plan.priceUsdCents,
          recurring: { interval: "month" },
        },
        quantity: 1,
      },
    ],
    metadata: { userId: user.id, kind: "plan", planId: id },
    success_url: `${appUrl}/credits?checkout=success`,
    cancel_url: `${appUrl}/credits?checkout=cancelled`,
  });

  res.json({ url: session.url });
});

// POST /api/billing/webhook — mounted with express.raw() in app.ts (needs the raw body for signature verification)
export async function handleStripeWebhook(req: express.Request, res: express.Response): Promise<void> {
  if (!stripe) {
    res.status(503).json({ error: "Billing is not configured" });
    return;
  }

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const signature = req.headers["stripe-signature"];
  if (!webhookSecret || !signature) {
    res.status(400).json({ error: "Missing webhook signature" });
    return;
  }

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, signature, webhookSecret);
  } catch (err) {
    logger.error({ err }, "Stripe webhook signature verification failed");
    res.status(400).json({ error: "Invalid signature" });
    return;
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as { metadata?: Record<string, string>; customer?: string; subscription?: string };
    const metadata = session.metadata ?? {};
    const userId = metadata.userId;

    if (userId) {
      if (metadata.kind === "credit_pack") {
        const pack = CREDIT_PACKS[metadata.packId as CreditPackId];
        if (pack) {
          await db
            .update(usersTable)
            .set({ boostCredits: sql`${usersTable.boostCredits} + ${pack.boosts}` })
            .where(eq(usersTable.id, userId));
          await db.insert(creditTransactionsTable).values({
            id: randomUUID(),
            userId,
            type: "purchase",
            amount: pack.boosts,
            stripePaymentIntentId: typeof session.customer === "string" ? session.customer : null,
          });
        }
      } else if (metadata.kind === "plan") {
        const planId = metadata.planId;
        const grant = PLAN_LIMITS[planId]?.monthlyBoostCredits ?? 0;
        await db
          .update(usersTable)
          .set({
            plan: planId,
            stripeSubscriptionId: typeof session.subscription === "string" ? session.subscription : null,
            boostCredits: sql`${usersTable.boostCredits} + ${grant}`,
          })
          .where(eq(usersTable.id, userId));
        if (grant > 0) {
          await db.insert(creditTransactionsTable).values({
            id: randomUUID(),
            userId,
            type: "plan_grant",
            amount: grant,
          });
        }
      }
    }
  }

  if (event.type === "customer.subscription.deleted") {
    const subscription = event.data.object as { id: string };
    await db
      .update(usersTable)
      .set({ plan: "free", stripeSubscriptionId: null })
      .where(eq(usersTable.stripeSubscriptionId, subscription.id));
  }

  res.json({ received: true });
}

export default router;
