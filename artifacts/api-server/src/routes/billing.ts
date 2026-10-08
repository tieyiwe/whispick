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
import { PLAN_LIMITS, GHOST_BOOST_ENABLED, isBillingEnabled } from "../lib/plans";
import { billingCheckoutLimiter } from "../lib/rateLimit";
import { logger } from "../lib/logger";

const router = Router();

const checkoutSchema = z.object({
  kind: z.enum(["credit_pack", "plan"]),
  id: z.string().min(1),
});

// POST /api/billing/checkout
router.post("/checkout", requireAuth, billingCheckoutLimiter, async (req, res): Promise<void> => {
  // Launching free: no checkout until billing is deliberately switched on
  // (BILLING_ENABLED=true + a Stripe key — see isBillingEnabled). The
  // webhook below stays live regardless, so nothing already paid is lost.
  if (!stripe || !isBillingEnabled()) {
    res.status(503).json({ error: "Payments aren't available yet — Blind Whisper is free for now.", code: "billing_disabled" });
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
    if (!GHOST_BOOST_ENABLED) {
      res.status(403).json({ error: "Ghost Boost credit packs aren't available right now." });
      return;
    }

    // Own-property only: an id like "toString" or "constructor" would
    // otherwise resolve to an Object.prototype member and 500 below.
    const pack = Object.hasOwn(CREDIT_PACKS, id) ? CREDIT_PACKS[id as CreditPackId] : undefined;
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
          product_data: { name: `Blind Whisper ${plan.label} plan` },
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

type CheckoutSessionLike = {
  id: string;
  payment_status?: string;
  metadata?: Record<string, string> | null;
  customer?: unknown;
  subscription?: unknown;
};

const SUBSCRIPTION_LAPSED_STATUSES = new Set(["unpaid", "canceled", "incomplete_expired"]);

async function downgradeSubscription(subscriptionId: string): Promise<void> {
  await db
    .update(usersTable)
    .set({ plan: "free", stripeSubscriptionId: null })
    .where(eq(usersTable.stripeSubscriptionId, subscriptionId));
}

// Grants whatever a paid checkout bought. Only called once payment has
// actually cleared (see handleStripeWebhook).
//
// Stripe retries webhook deliveries (e.g. after a timeout on our end), and a
// delayed-payment checkout legitimately produces both a completed and an
// async_payment_succeeded event — either would otherwise double-grant. The
// session id is unique per checkout, so it's used as an idempotency key — but
// the insert claiming that key has to happen BEFORE the credit/plan grant,
// not after: a select-then-act check (reading whether a transaction row
// already exists, then granting, then inserting) leaves a window where two
// concurrent deliveries can both pass the "not yet processed" read before
// either commits its insert, both then grant, and only the second insert
// fails on the unique constraint. Inserting first with onConflictDoNothing
// makes the claim itself atomic: only the delivery whose insert actually adds
// a new row is allowed to touch the user's balance/plan at all.
async function grantCheckoutSession(session: CheckoutSessionLike): Promise<void> {
  const metadata = session.metadata ?? {};
  const userId = metadata.userId;
  if (!userId) return;

  if (metadata.kind === "credit_pack") {
    const pack = metadata.packId && Object.hasOwn(CREDIT_PACKS, metadata.packId) ? CREDIT_PACKS[metadata.packId as CreditPackId] : undefined;
    if (!pack) return;
    const inserted = await db
      .insert(creditTransactionsTable)
      .values({
        id: randomUUID(),
        userId,
        type: "purchase",
        amount: pack.boosts,
        stripePaymentIntentId: session.id,
      })
      .onConflictDoNothing({ target: creditTransactionsTable.stripePaymentIntentId })
      .returning({ id: creditTransactionsTable.id });
    if (inserted.length > 0) {
      await db
        .update(usersTable)
        .set({ boostCredits: sql`${usersTable.boostCredits} + ${pack.boosts}` })
        .where(eq(usersTable.id, userId));
    }
  } else if (metadata.kind === "plan") {
    const planId = metadata.planId;
    const grant = PLAN_LIMITS[planId]?.monthlyBoostCredits ?? 0;
    // Even a zero-credit plan still needs its own idempotency claim
    // (amount: 0 is a real, insertable row) — otherwise a redelivered event
    // for a no-credit plan would re-set stripeSubscriptionId/plan every time
    // instead of only once.
    const inserted = await db
      .insert(creditTransactionsTable)
      .values({
        id: randomUUID(),
        userId,
        type: "plan_grant",
        amount: grant,
        stripePaymentIntentId: session.id,
      })
      .onConflictDoNothing({ target: creditTransactionsTable.stripePaymentIntentId })
      .returning({ id: creditTransactionsTable.id });
    if (inserted.length > 0) {
      await db
        .update(usersTable)
        .set({
          plan: planId,
          stripeSubscriptionId: typeof session.subscription === "string" ? session.subscription : null,
          boostCredits: sql`${usersTable.boostCredits} + ${grant}`,
        })
        .where(eq(usersTable.id, userId));
    }
  }
}

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

  // checkout.session.completed fires for EVERY finished checkout — including
  // ones paid by a delayed method (ACH debit, bank transfer, some wallets),
  // which complete with payment_status "unpaid" and only settle (or fail)
  // days later via the async_payment_* events. Granting on completion alone
  // handed out credits/plans for payments that never cleared. Grant only once
  // the money is actually there; grantCheckoutSession's idempotency claim
  // (keyed by session id) keeps the completed + async_succeeded pair, or any
  // redelivery, from double-granting.
  if (event.type === "checkout.session.completed") {
    const session = event.data.object as CheckoutSessionLike;
    if (session.payment_status === "paid" || session.payment_status === "no_payment_required") {
      await grantCheckoutSession(session);
    } else {
      logger.info({ sessionId: session.id, paymentStatus: session.payment_status }, "Checkout completed but not yet paid; waiting for async payment result");
    }
  }

  if (event.type === "checkout.session.async_payment_succeeded") {
    await grantCheckoutSession(event.data.object as CheckoutSessionLike);
  }

  if (event.type === "checkout.session.async_payment_failed") {
    // Nothing was granted on completion (it was unpaid), so there's nothing
    // to roll back — just leave a trace for support.
    const session = event.data.object as CheckoutSessionLike;
    logger.warn({ sessionId: session.id, userId: session.metadata?.userId }, "Checkout async payment failed; no credits/plan granted");
  }

  if (event.type === "customer.subscription.deleted") {
    const subscription = event.data.object as { id: string };
    await downgradeSubscription(subscription.id);
  }

  // A subscription that stops being paid without being deleted outright
  // (dunning exhausted → unpaid/canceled, or a first invoice that never
  // cleared → incomplete_expired) must lose plan access the same way a
  // deletion does. past_due is deliberately left alone: Stripe is still
  // retrying the charge and the plan should survive a transient card decline.
  if (event.type === "customer.subscription.updated") {
    const subscription = event.data.object as { id: string; status?: string };
    if (subscription.status && SUBSCRIPTION_LAPSED_STATUSES.has(subscription.status)) {
      await downgradeSubscription(subscription.id);
    }
  }

  res.json({ received: true });
}

export default router;
