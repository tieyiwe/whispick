import { Router } from "express";
import { db, matchSubscribersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import { z } from "zod";
import { VIDEO_CATEGORIES } from "../lib/categorize";
import { sendEmail, subscriptionVerificationEmailHtml } from "../lib/email";
import { getPublicAppUrl } from "../lib/publicUrl";

const router = Router();

const VALID_CATEGORY_KEYS = new Set<string>(VIDEO_CATEGORIES.map((c) => c.key));

const subscribeSchema = z.object({
  email: z.string().email(),
  categories: z
    .array(z.string())
    .min(1, "Pick at least one topic")
    .max(8, "Pick up to 8 topics")
    .refine((arr) => arr.every((k) => VALID_CATEGORY_KEYS.has(k)), { message: "Unknown category" }),
});

// POST /api/public/subscribe — opt in to receive anonymous Ghost Boost
// whisps on chosen topics. No Whispick account needed, matching the app's
// no-account-required spirit for receiving a whisp at all. Double opt-in
// (a verification email must be confirmed before this row is match-eligible
// — see lib/matching.ts) so a stranger can't sign someone else's email up
// to be spammed with anonymous videos.
router.post("/subscribe", async (req, res): Promise<void> => {
  const parsed = subscribeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { email, categories } = parsed.data;
  const existing = await db.select().from(matchSubscribersTable).where(eq(matchSubscribersTable.email, email)).then((r) => r[0]);

  let token: string;
  let alreadyVerified: boolean;

  if (existing) {
    token = existing.token;
    alreadyVerified = !!existing.verifiedAt;
    await db
      .update(matchSubscribersTable)
      .set({ categories, unsubscribedAt: null })
      .where(eq(matchSubscribersTable.id, existing.id));
  } else {
    token = randomUUID();
    alreadyVerified = false;
    await db.insert(matchSubscribersTable).values({ id: randomUUID(), email, categories, token });
  }

  if (!alreadyVerified) {
    const verifyUrl = `${getPublicAppUrl(req)}/verify-subscription?token=${token}`;
    void sendEmail(email, "Confirm your Whispick subscription", subscriptionVerificationEmailHtml(verifyUrl));
  }

  res.json({ ok: true, alreadyVerified });
});

// GET /api/public/subscribe/verify — one-click confirmation link, so a GET
// (not a POST) is the right tool here, same as any mailing-list confirm.
router.get("/subscribe/verify", async (req, res): Promise<void> => {
  const token = typeof req.query.token === "string" ? req.query.token : null;
  if (!token) {
    res.status(400).json({ error: "Missing token" });
    return;
  }

  const subscriber = await db.select().from(matchSubscribersTable).where(eq(matchSubscribersTable.token, token)).then((r) => r[0]);
  if (!subscriber) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  if (!subscriber.verifiedAt) {
    await db.update(matchSubscribersTable).set({ verifiedAt: new Date() }).where(eq(matchSubscribersTable.id, subscriber.id));
  }

  res.json({ ok: true });
});

// GET /api/public/subscribe/unsubscribe — one-click, no login, standard for
// email compliance. Idempotent.
router.get("/subscribe/unsubscribe", async (req, res): Promise<void> => {
  const token = typeof req.query.token === "string" ? req.query.token : null;
  if (!token) {
    res.status(400).json({ error: "Missing token" });
    return;
  }

  const subscriber = await db.select().from(matchSubscribersTable).where(eq(matchSubscribersTable.token, token)).then((r) => r[0]);
  if (!subscriber) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  if (!subscriber.unsubscribedAt) {
    await db.update(matchSubscribersTable).set({ unsubscribedAt: new Date() }).where(eq(matchSubscribersTable.id, subscriber.id));
  }

  res.json({ ok: true });
});

export default router;
