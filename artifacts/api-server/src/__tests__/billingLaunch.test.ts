import { describe, it, expect, afterEach } from "vitest";
import request from "supertest";
import { randomUUID } from "crypto";
import app from "../app";
import { TEST_USER_HEADER } from "./setup";
import { isBillingEnabled, whisperLinkLimitFor } from "../lib/plans";

// Blind Whisper launches free: payments stay off until BILLING_ENABLED=true
// AND a Stripe key are both set. While off, free accounts have no monthly
// Whisper Link cap (there'd be no way to upgrade past it).
const saved = {
  billing: process.env.BILLING_ENABLED,
  stripe: process.env.STRIPE_SECRET_KEY,
  cap: process.env.FREE_PLAN_WHISPER_LINKS,
};

function restore(key: string, value: string | undefined) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

afterEach(() => {
  restore("BILLING_ENABLED", saved.billing);
  restore("STRIPE_SECRET_KEY", saved.stripe);
  restore("FREE_PLAN_WHISPER_LINKS", saved.cap);
});

describe("free launch (billing off)", () => {
  it("reports billing off by default in the public config", async () => {
    delete process.env.BILLING_ENABLED;
    const res = await request(app).get("/api/config");
    expect(res.status).toBe(200);
    expect(res.body.billingEnabled).toBe(false);
  });

  it("needs both the switch and a Stripe key to turn billing on", () => {
    process.env.BILLING_ENABLED = "true";
    delete process.env.STRIPE_SECRET_KEY;
    expect(isBillingEnabled()).toBe(false);

    process.env.STRIPE_SECRET_KEY = "sk_test_placeholder";
    delete process.env.BILLING_ENABLED;
    expect(isBillingEnabled()).toBe(false);

    process.env.BILLING_ENABLED = "TRUE";
    expect(isBillingEnabled()).toBe(true);
  });

  it("uncaps the free plan while billing is off, and restores the 3/month cap once it's on", () => {
    delete process.env.FREE_PLAN_WHISPER_LINKS;
    delete process.env.BILLING_ENABLED;
    expect(whisperLinkLimitFor("free")).toBeNull();

    process.env.BILLING_ENABLED = "true";
    process.env.STRIPE_SECRET_KEY = "sk_test_placeholder";
    expect(whisperLinkLimitFor("free")).toBe(3);

    // An explicit override always wins.
    process.env.FREE_PLAN_WHISPER_LINKS = "unlimited";
    expect(whisperLinkLimitFor("free")).toBeNull();
  });

  it("lets a free account send more than 3 Whisper Links in a month while billing is off", async () => {
    delete process.env.FREE_PLAN_WHISPER_LINKS;
    delete process.env.BILLING_ENABLED;
    const sender = `clerk_free_launch_${randomUUID()}`;
    for (let i = 0; i < 5; i++) {
      const res = await request(app)
        .post("/api/whisps")
        .set(TEST_USER_HEADER, sender)
        .send({
          videoUrl: "https://youtu.be/x",
          deliveryMethod: "whisper_link",
          whisperChannel: "email",
          recipientEmail: `friend${i}@example.com`,
        });
      expect(res.status).toBe(201);
    }
  });

  it("refuses checkout while billing is off", async () => {
    delete process.env.BILLING_ENABLED;
    const res = await request(app)
      .post("/api/billing/checkout")
      .set(TEST_USER_HEADER, "clerk_billing_off")
      .send({ kind: "credit_pack", id: "single" });
    expect(res.status).toBe(503);
  });
});
