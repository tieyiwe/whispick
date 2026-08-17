import Stripe from "stripe";

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;

export const stripe = STRIPE_SECRET_KEY ? new Stripe(STRIPE_SECRET_KEY) : null;

export const CREDIT_PACKS = {
  single: { boosts: 1, priceUsdCents: 699, label: "Single Boost" },
  triple: { boosts: 3, priceUsdCents: 1799, label: "3-Pack" },
  ten: { boosts: 10, priceUsdCents: 4999, label: "10-Pack" },
  twentyfive: { boosts: 25, priceUsdCents: 9999, label: "25-Pack" },
} as const;

export type CreditPackId = keyof typeof CREDIT_PACKS;

export const PLAN_PRICES = {
  spark: { priceUsdCents: 999, label: "Spark" },
  ember: { priceUsdCents: 1999, label: "Ember" },
} as const;

export type PlanId = keyof typeof PLAN_PRICES;
