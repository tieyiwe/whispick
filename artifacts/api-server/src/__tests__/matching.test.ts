import { describe, it, expect, vi } from "vitest";
import request from "supertest";
import { randomUUID } from "crypto";
import app from "../app";
import { db, usersTable, whispsTable, whispCategoriesTable, matchSubscribersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { TEST_USER_HEADER } from "./setup";
import { matchGhostBoostWhisp, getGhostBoostMatchStats, MAX_MATCHES_PER_SEND } from "../lib/matching";

// Whisp creation fires categorizeWhispAsync in the background (a real
// network transcript fetch + delete-then-insert into whisp_categories) —
// left un-mocked it races with this file's own direct inserts/assertions
// against whisp_categories. Neutralize it so category state here is only
// ever whatever each test sets up explicitly.
vi.mock("../lib/categorizeWhisp", () => ({
  categorizeWhispAsync: async () => {},
  categorizeWhispsAsync: async () => {},
}));

// notifyUser is a no-op without VAPID keys (unset in tests) either way, so
// mocking it here is the only way to distinguish "the ghost_boost fan-out
// guard skipped the call" from "it was called and silently no-opped."
const notifyUserMock = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("../lib/push", () => ({ notifyUser: notifyUserMock }));

function asUser(userId: string) {
  return { [TEST_USER_HEADER]: userId };
}

async function getUser(clerkId: string) {
  return db.select().from(usersTable).where(eq(usersTable.clerkId, clerkId)).then((r) => r[0]);
}

async function createGhostBoostWhisp(clerkId: string) {
  await request(app).get("/api/user/profile").set(asUser(clerkId));
  const user = await getUser(clerkId);
  await db.update(usersTable).set({ boostCredits: 1 }).where(eq(usersTable.id, user.id));

  const res = await request(app)
    .post("/api/whisps")
    .set(asUser(clerkId))
    .send({ videoUrl: "https://youtu.be/x", deliveryMethod: "ghost_boost" });
  expect(res.status).toBe(201);
  return res.body as { id: string; publicToken: string };
}

async function getWhispRow(id: string) {
  return db.select().from(whispsTable).where(eq(whispsTable.id, id)).then((r) => r[0]);
}

async function insertCategory(whispId: string, category: string) {
  await db.insert(whispCategoriesTable).values({ id: randomUUID(), whispId, category, rank: 1, score: 10 });
}

async function insertSubscriber(overrides: Partial<typeof matchSubscribersTable.$inferInsert> = {}) {
  const row = {
    id: randomUUID(),
    email: `subscriber-${randomUUID()}@example.com`,
    categories: ["music"],
    token: randomUUID(),
    verifiedAt: new Date(),
    unsubscribedAt: null,
    lastMatchedAt: null,
    ...overrides,
  };
  await db.insert(matchSubscribersTable).values(row);
  return row;
}

describe("matchGhostBoostWhisp", () => {
  it("matches a verified subscriber whose categories overlap and records lastMatchedAt", async () => {
    const whisp = await createGhostBoostWhisp("clerk_match_1");
    await insertCategory(whisp.id, "music");
    const subscriber = await insertSubscriber({ email: "sub1@example.com", categories: ["music"] });

    const row = await getWhispRow(whisp.id);
    const result = await matchGhostBoostWhisp(row, "https://app.example.com");

    expect(result).toEqual({ newMatches: 1, totalMatched: 1, done: false });

    const fanOut = await db.select().from(whispsTable).where(eq(whispsTable.groupSendId, whisp.id));
    expect(fanOut).toHaveLength(1);
    expect(fanOut[0].recipientEmail).toBe("sub1@example.com");
    expect(fanOut[0].deliveryMethod).toBe("ghost_boost");
    expect(fanOut[0].status).toBe("delivered");
    expect(fanOut[0].senderId).toBe(row.senderId);

    const updatedSub = await db
      .select()
      .from(matchSubscribersTable)
      .where(eq(matchSubscribersTable.id, subscriber.id))
      .then((r) => r[0]);
    expect(updatedSub.lastMatchedAt).not.toBeNull();
  });

  it("does not match an unverified subscriber", async () => {
    const whisp = await createGhostBoostWhisp("clerk_match_2");
    await insertCategory(whisp.id, "music");
    await insertSubscriber({ categories: ["music"], verifiedAt: null });

    const result = await matchGhostBoostWhisp(await getWhispRow(whisp.id), "https://app.example.com");
    expect(result.newMatches).toBe(0);
  });

  it("does not match an unsubscribed subscriber", async () => {
    const whisp = await createGhostBoostWhisp("clerk_match_3");
    await insertCategory(whisp.id, "music");
    await insertSubscriber({ categories: ["music"], unsubscribedAt: new Date() });

    const result = await matchGhostBoostWhisp(await getWhispRow(whisp.id), "https://app.example.com");
    expect(result.newMatches).toBe(0);
  });

  it("does not match a subscriber still inside the cooldown window, but does match one outside it", async () => {
    const whisp = await createGhostBoostWhisp("clerk_match_4");
    await insertCategory(whisp.id, "music");
    await insertSubscriber({ email: "on-cooldown@example.com", categories: ["music"], lastMatchedAt: new Date() });
    await insertSubscriber({
      email: "off-cooldown@example.com",
      categories: ["music"],
      lastMatchedAt: new Date(Date.now() - 49 * 60 * 60 * 1000),
    });

    const result = await matchGhostBoostWhisp(await getWhispRow(whisp.id), "https://app.example.com");
    expect(result.newMatches).toBe(1);

    const fanOut = await db.select().from(whispsTable).where(eq(whispsTable.groupSendId, whisp.id));
    expect(fanOut.map((f) => f.recipientEmail)).toEqual(["off-cooldown@example.com"]);
  });

  it("only matches subscribers whose categories overlap the whisp's categories", async () => {
    const whisp = await createGhostBoostWhisp("clerk_match_5");
    await insertCategory(whisp.id, "music");
    await insertSubscriber({ email: "wrong-topic@example.com", categories: ["comedy"] });
    await insertSubscriber({ email: "right-topic@example.com", categories: ["travel", "music"] });

    const result = await matchGhostBoostWhisp(await getWhispRow(whisp.id), "https://app.example.com");
    expect(result.newMatches).toBe(1);

    const fanOut = await db.select().from(whispsTable).where(eq(whispsTable.groupSendId, whisp.id));
    expect(fanOut.map((f) => f.recipientEmail)).toEqual(["right-topic@example.com"]);
  });

  it("waits for categorization within the grace period instead of falling back broadly", async () => {
    const whisp = await createGhostBoostWhisp("clerk_match_6");
    await insertSubscriber({ categories: ["gaming"] });

    const result = await matchGhostBoostWhisp(await getWhispRow(whisp.id), "https://app.example.com");
    expect(result).toEqual({ newMatches: 0, totalMatched: 0, done: false });
  });

  it("falls back to a broad, category-agnostic match once the grace period has passed with no categories", async () => {
    const whisp = await createGhostBoostWhisp("clerk_match_7");
    await insertSubscriber({ email: "broad@example.com", categories: ["gaming"] });

    const row = { ...(await getWhispRow(whisp.id)), createdAt: new Date(Date.now() - 6 * 60 * 1000) };
    const result = await matchGhostBoostWhisp(row, "https://app.example.com");
    expect(result.newMatches).toBe(1);
  });

  it("caps matches at MAX_MATCHES_PER_SEND and marks the campaign done", async () => {
    const whisp = await createGhostBoostWhisp("clerk_match_8");
    await insertCategory(whisp.id, "music");
    for (let i = 0; i < MAX_MATCHES_PER_SEND + 1; i++) {
      await insertSubscriber({ email: `bulk-${i}@example.com`, categories: ["music"] });
    }

    const result = await matchGhostBoostWhisp(await getWhispRow(whisp.id), "https://app.example.com");
    expect(result.newMatches).toBe(MAX_MATCHES_PER_SEND);
    expect(result.totalMatched).toBe(MAX_MATCHES_PER_SEND);
    expect(result.done).toBe(true);

    const fanOut = await db.select().from(whispsTable).where(eq(whispsTable.groupSendId, whisp.id));
    expect(fanOut).toHaveLength(MAX_MATCHES_PER_SEND);
  });

  it("marks a campaign done once its matching window has closed, even with no matches", async () => {
    const whisp = await createGhostBoostWhisp("clerk_match_9");
    const row = { ...(await getWhispRow(whisp.id)), createdAt: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000) };

    const result = await matchGhostBoostWhisp(row, "https://app.example.com");
    expect(result).toEqual({ newMatches: 0, totalMatched: 0, done: true });
  });
});

describe("getGhostBoostMatchStats", () => {
  it("aggregates opens/watches/replies/appreciations across a campaign's fan-out rows", async () => {
    const whisp = await createGhostBoostWhisp("clerk_match_stats");

    async function insertFanOut(overrides: Partial<typeof whispsTable.$inferInsert>) {
      await db.insert(whispsTable).values({
        id: randomUUID(),
        senderId: whisp.id, // arbitrary, not exercised here
        videoUrl: "https://youtu.be/x",
        deliveryMethod: "ghost_boost",
        groupSendId: whisp.id,
        recipientEmail: `fan-${randomUUID()}@example.com`,
        status: "delivered",
        publicToken: randomUUID().replace(/-/g, ""),
        ...overrides,
      });
    }

    await insertFanOut({ openedAt: new Date(), watchedAt: new Date(), status: "replied" });
    await insertFanOut({ openedAt: new Date(), appreciationResponse: "yes" });
    await insertFanOut({});

    const stats = await getGhostBoostMatchStats(whisp.id);
    expect(stats.matchedCount).toBe(3);
    expect(stats.openedCount).toBe(2);
    expect(stats.watchedCount).toBe(1);
    expect(stats.repliedCount).toBe(1);
    expect(stats.appreciatedCount).toBe(1);
  });

  it("returns all zeroes for a campaign with no matches yet", async () => {
    const whisp = await createGhostBoostWhisp("clerk_match_stats_empty");
    const stats = await getGhostBoostMatchStats(whisp.id);
    expect(stats).toEqual({ matchedCount: 0, openedCount: 0, watchedCount: 0, repliedCount: 0, appreciatedCount: 0 });
  });
});

describe("POST /api/public/subscribe", () => {
  it("rejects an invalid email", async () => {
    const res = await request(app).post("/api/public/subscribe").send({ email: "not-an-email", categories: ["music"] });
    expect(res.status).toBe(400);
  });

  it("rejects an unknown category", async () => {
    const res = await request(app)
      .post("/api/public/subscribe")
      .send({ email: "person@example.com", categories: ["not-a-real-category"] });
    expect(res.status).toBe(400);
  });

  it("rejects an empty category list", async () => {
    const res = await request(app).post("/api/public/subscribe").send({ email: "person@example.com", categories: [] });
    expect(res.status).toBe(400);
  });

  it("creates a new, unverified subscriber and reports alreadyVerified: false", async () => {
    const res = await request(app)
      .post("/api/public/subscribe")
      .send({ email: "new-subscriber@example.com", categories: ["music", "comedy"] });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, alreadyVerified: false });

    const row = await db
      .select()
      .from(matchSubscribersTable)
      .where(eq(matchSubscribersTable.email, "new-subscriber@example.com"))
      .then((r) => r[0]);
    expect(row.verifiedAt).toBeNull();
    expect(row.categories).toEqual(["music", "comedy"]);
  });

  it("updates categories when a still-subscribed existing subscriber signs up again", async () => {
    await request(app).post("/api/public/subscribe").send({ email: "repeat@example.com", categories: ["music"] });
    const first = await db
      .select()
      .from(matchSubscribersTable)
      .where(eq(matchSubscribersTable.email, "repeat@example.com"))
      .then((r) => r[0]);
    await db.update(matchSubscribersTable).set({ verifiedAt: new Date() }).where(eq(matchSubscribersTable.id, first.id));

    const res = await request(app)
      .post("/api/public/subscribe")
      .send({ email: "repeat@example.com", categories: ["travel"] });

    // alreadyVerified is now deliberately always false in the response to
    // avoid an email-membership enumeration oracle — the categories still
    // update, and the internal "don't re-email a confirmed subscriber" logic
    // still runs, but the response no longer reveals prior-verification state.
    expect(res.body).toEqual({ ok: true, alreadyVerified: false });
    const updated = await db
      .select()
      .from(matchSubscribersTable)
      .where(eq(matchSubscribersTable.id, first.id))
      .then((r) => r[0]);
    expect(updated.categories).toEqual(["travel"]);
    expect(updated.token).toBe(first.token);
  });

  it("normalizes email case so the same inbox can't create two rows", async () => {
    await request(app).post("/api/public/subscribe").send({ email: "Mixed.Case@Example.com", categories: ["music"] });
    const res = await request(app)
      .post("/api/public/subscribe")
      .send({ email: "mixed.case@example.com", categories: ["travel"] });

    expect(res.body.alreadyVerified).toBe(false);
    const rows = await db
      .select()
      .from(matchSubscribersTable)
      .where(eq(matchSubscribersTable.email, "mixed.case@example.com"));
    expect(rows).toHaveLength(1);
    expect(rows[0].categories).toEqual(["travel"]);
  });

  it("does not silently resubscribe a previously-unsubscribed address, and requires re-verification", async () => {
    // A stranger who merely knows the address must not be able to
    // resubscribe it without proving inbox access via a fresh verify click.
    await request(app).post("/api/public/subscribe").send({ email: "was-unsubscribed@example.com", categories: ["music"] });
    const first = await db
      .select()
      .from(matchSubscribersTable)
      .where(eq(matchSubscribersTable.email, "was-unsubscribed@example.com"))
      .then((r) => r[0]);
    await db
      .update(matchSubscribersTable)
      .set({ verifiedAt: new Date(), unsubscribedAt: new Date() })
      .where(eq(matchSubscribersTable.id, first.id));

    const res = await request(app)
      .post("/api/public/subscribe")
      .send({ email: "was-unsubscribed@example.com", categories: ["travel"] });

    expect(res.body).toEqual({ ok: true, alreadyVerified: false });
    const afterRepost = await db
      .select()
      .from(matchSubscribersTable)
      .where(eq(matchSubscribersTable.id, first.id))
      .then((r) => r[0]);
    expect(afterRepost.categories).toEqual(["travel"]);
    expect(afterRepost.unsubscribedAt).not.toBeNull(); // still unsubscribed — a bare POST can't clear this
    expect(afterRepost.verifiedAt).toBeNull(); // must re-prove ownership

    // Clicking the (re-sent) verification link is what actually reactivates it.
    const verifyRes = await request(app).get("/api/public/subscribe/verify").query({ token: first.token });
    expect(verifyRes.status).toBe(200);
    const afterVerify = await db
      .select()
      .from(matchSubscribersTable)
      .where(eq(matchSubscribersTable.id, first.id))
      .then((r) => r[0]);
    expect(afterVerify.unsubscribedAt).toBeNull();
    expect(afterVerify.verifiedAt).not.toBeNull();
  });
});

describe("GET /api/public/subscribe/verify", () => {
  it("requires a token", async () => {
    const res = await request(app).get("/api/public/subscribe/verify");
    expect(res.status).toBe(400);
  });

  it("404s for an unknown token", async () => {
    const res = await request(app).get("/api/public/subscribe/verify").query({ token: "does-not-exist" });
    expect(res.status).toBe(404);
  });

  it("sets verifiedAt and is idempotent", async () => {
    const subscriber = await insertSubscriber({ verifiedAt: null });

    const first = await request(app).get("/api/public/subscribe/verify").query({ token: subscriber.token });
    expect(first.status).toBe(200);
    const afterFirst = await db
      .select()
      .from(matchSubscribersTable)
      .where(eq(matchSubscribersTable.id, subscriber.id))
      .then((r) => r[0]);
    expect(afterFirst.verifiedAt).not.toBeNull();

    const second = await request(app).get("/api/public/subscribe/verify").query({ token: subscriber.token });
    expect(second.status).toBe(200);
  });
});

describe("GET /api/public/subscribe/unsubscribe", () => {
  it("requires a token", async () => {
    const res = await request(app).get("/api/public/subscribe/unsubscribe");
    expect(res.status).toBe(400);
  });

  it("404s for an unknown token", async () => {
    const res = await request(app).get("/api/public/subscribe/unsubscribe").query({ token: "does-not-exist" });
    expect(res.status).toBe(404);
  });

  it("sets unsubscribedAt and is idempotent", async () => {
    const subscriber = await insertSubscriber();

    const first = await request(app).get("/api/public/subscribe/unsubscribe").query({ token: subscriber.token });
    expect(first.status).toBe(200);
    const afterFirst = await db
      .select()
      .from(matchSubscribersTable)
      .where(eq(matchSubscribersTable.id, subscriber.id))
      .then((r) => r[0]);
    expect(afterFirst.unsubscribedAt).not.toBeNull();

    const second = await request(app).get("/api/public/subscribe/unsubscribe").query({ token: subscriber.token });
    expect(second.status).toBe(200);
  });
});

describe("Ghost Boost matched-delivery privacy", () => {
  async function setupCampaignWithFanOut(clerkId: string) {
    const campaign = await createGhostBoostWhisp(clerkId);
    const user = await getUser(clerkId);
    const fanOutId = randomUUID();
    await db.insert(whispsTable).values({
      id: fanOutId,
      senderId: user.id,
      videoUrl: "https://youtu.be/x",
      deliveryMethod: "ghost_boost",
      groupSendId: campaign.id,
      recipientEmail: "matched-stranger@example.com",
      status: "delivered",
      publicToken: randomUUID().replace(/-/g, ""),
      openedAt: new Date(),
      appreciationResponse: "yes",
    });
    return { campaign, fanOutId };
  }

  it("excludes matched-subscriber fan-out rows from the sender's whisp list", async () => {
    const clerkId = "clerk_privacy_list";
    const { campaign, fanOutId } = await setupCampaignWithFanOut(clerkId);

    const res = await request(app).get("/api/whisps").set(asUser(clerkId));
    const ids = res.body.map((w: { id: string }) => w.id);
    expect(ids).toContain(campaign.id);
    expect(ids).not.toContain(fanOutId);
    expect(JSON.stringify(res.body)).not.toContain("matched-stranger@example.com");
  });

  it("excludes matched-subscriber fan-out rows from the sender's stats", async () => {
    const clerkId = "clerk_privacy_stats";
    await setupCampaignWithFanOut(clerkId);

    const res = await request(app).get("/api/whisps/stats").set(asUser(clerkId));
    expect(res.body.totalSent).toBe(1);
    expect(JSON.stringify(res.body)).not.toContain("matched-stranger@example.com");
  });

  it("404s a direct lookup of a matched-subscriber fan-out row by id", async () => {
    const clerkId = "clerk_privacy_detail";
    const { fanOutId } = await setupCampaignWithFanOut(clerkId);

    const res = await request(app).get(`/api/whisps/${fanOutId}`).set(asUser(clerkId));
    expect(res.status).toBe(404);
  });

  it("exposes only aggregate stats via GET /:id/matches", async () => {
    const clerkId = "clerk_privacy_matches";
    const { campaign } = await setupCampaignWithFanOut(clerkId);

    const res = await request(app).get(`/api/whisps/${campaign.id}/matches`).set(asUser(clerkId));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ matchedCount: 1, openedCount: 1, watchedCount: 0, repliedCount: 0, appreciatedCount: 1 });
    expect(JSON.stringify(res.body)).not.toContain("matched-stranger@example.com");
  });

  it("404s GET /:id/matches for a non-Ghost-Boost whisp", async () => {
    const clerkId = "clerk_privacy_matches_wrong_method";
    const res = await request(app)
      .post("/api/whisps")
      .set(asUser(clerkId))
      .send({
        videoUrl: "https://youtu.be/x",
        deliveryMethod: "whisper_link",
        whisperChannel: "email",
        recipientEmail: "friend@example.com",
      });

    const matches = await request(app).get(`/api/whisps/${res.body.id}/matches`).set(asUser(clerkId));
    expect(matches.status).toBe(404);
  });

  it("404s GET /:id/matches for another sender's campaign", async () => {
    const { campaign } = await setupCampaignWithFanOut("clerk_privacy_owner");
    const res = await request(app).get(`/api/whisps/${campaign.id}/matches`).set(asUser("clerk_privacy_intruder"));
    expect(res.status).toBe(404);
  });

  it("404s every other sender-facing lookup on a matched-subscriber fan-out row, not just GET /:id", async () => {
    const clerkId = "clerk_privacy_endpoints";
    const { fanOutId } = await setupCampaignWithFanOut(clerkId);
    const auth = asUser(clerkId);

    expect((await request(app).get(`/api/whisps/${fanOutId}/replies`).set(auth)).status).toBe(404);
    expect((await request(app).post(`/api/whisps/${fanOutId}/replies`).set(auth).send({ replyText: "hi" })).status).toBe(404);
    expect((await request(app).post(`/api/whisps/${fanOutId}/reveal`).set(auth)).status).toBe(404);
    expect((await request(app).delete(`/api/whisps/${fanOutId}`).set(auth)).status).toBe(404);

    // The fan-out row must still exist — the delete attempt above was
    // rejected, not silently a no-op that happened to also succeed.
    const stillThere = await db.select().from(whispsTable).where(eq(whispsTable.id, fanOutId)).then((r) => r[0]);
    expect(stillThere).toBeDefined();
  });
});

describe("Ghost Boost matched-delivery notification suppression", () => {
  it("does not push/email the sender for individual open/watch/reply/appreciation events on a matched fan-out row", async () => {
    notifyUserMock.mockClear();
    const clerkId = "clerk_notify_ghost_boost";
    const campaign = await createGhostBoostWhisp(clerkId);
    const fanOutId = randomUUID();
    const publicToken = randomUUID().replace(/-/g, "");
    await db.insert(whispsTable).values({
      id: fanOutId,
      senderId: (await getUser(clerkId)).id,
      videoUrl: "https://youtu.be/x",
      deliveryMethod: "ghost_boost",
      groupSendId: campaign.id,
      recipientEmail: "matched-stranger@example.com",
      status: "delivered",
      publicToken,
    });

    await request(app).post(`/api/public/w/${publicToken}/track`).send({ eventType: "opened" });
    await request(app).post(`/api/public/w/${publicToken}/track`).send({ eventType: "watched_complete" });
    await request(app).post(`/api/public/w/${publicToken}/reply`).send({ replyText: "thanks" });
    await request(app).post(`/api/public/w/${publicToken}/appreciation`).send({ appreciated: true });

    expect(notifyUserMock).not.toHaveBeenCalled();
  });

  it("still notifies the sender for a normal whisper_link whisp (control — suppression isn't global)", async () => {
    notifyUserMock.mockClear();
    const clerkId = "clerk_notify_whisper_link";
    const res = await request(app)
      .post("/api/whisps")
      .set(asUser(clerkId))
      .send({
        videoUrl: "https://youtu.be/x",
        deliveryMethod: "whisper_link",
        whisperChannel: "email",
        recipientEmail: "friend@example.com",
      });

    await request(app).post(`/api/public/w/${res.body.publicToken}/track`).send({ eventType: "opened" });

    expect(notifyUserMock).toHaveBeenCalled();
  });
});
