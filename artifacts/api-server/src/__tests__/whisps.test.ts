import { describe, it, expect } from "vitest";
import request from "supertest";
import app from "../app";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { TEST_USER_HEADER } from "./setup";

const USER_A = "clerk_user_a";
const USER_B = "clerk_user_b";

function asUser(userId: string) {
  return { [TEST_USER_HEADER]: userId };
}

async function getUser(clerkId: string) {
  return db.select().from(usersTable).where(eq(usersTable.clerkId, clerkId)).then((r) => r[0]);
}

describe("POST /api/whisps", () => {
  it("rejects unauthenticated requests", async () => {
    const res = await request(app).post("/api/whisps").send({ videoUrl: "https://youtu.be/x", deliveryMethod: "whisper_link" });
    expect(res.status).toBe(401);
  });

  it("requires a delivery channel for whisper_link", async () => {
    const res = await request(app)
      .post("/api/whisps")
      .set(asUser(USER_A))
      .send({ videoUrl: "https://youtu.be/x", deliveryMethod: "whisper_link" });
    expect(res.status).toBe(400);
  });

  it("requires a recipient email when the channel is email", async () => {
    const res = await request(app)
      .post("/api/whisps")
      .set(asUser(USER_A))
      .send({ videoUrl: "https://youtu.be/x", deliveryMethod: "whisper_link", whisperChannel: "email" });
    expect(res.status).toBe(400);
  });

  it("requires a recipient phone when the channel is sms or whatsapp", async () => {
    const res = await request(app)
      .post("/api/whisps")
      .set(asUser(USER_A))
      .send({ videoUrl: "https://youtu.be/x", deliveryMethod: "whisper_link", whisperChannel: "whatsapp" });
    expect(res.status).toBe(400);
  });

  it("sends a whisper_link whisp via email and increments the sender's usage counter", async () => {
    const res = await request(app)
      .post("/api/whisps")
      .set(asUser(USER_A))
      .send({
        videoUrl: "https://youtu.be/x",
        deliveryMethod: "whisper_link",
        whisperChannel: "email",
        recipientEmail: "friend@example.com",
      });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe("delivered");
    expect(res.body.deliveredAt).not.toBeNull();
    expect(res.body.whisperChannel).toBe("email");

    const user = await getUser(USER_A);
    expect(user.whisperLinksUsed).toBe(1);
  });

  it("sends a whisper_link whisp via SMS using the recipient phone number", async () => {
    const res = await request(app)
      .post("/api/whisps")
      .set(asUser(USER_A))
      .send({
        videoUrl: "https://youtu.be/x",
        deliveryMethod: "whisper_link",
        whisperChannel: "sms",
        recipientPhone: "+15551234567",
      });

    expect(res.status).toBe(201);
    expect(res.body.whisperChannel).toBe("sms");
    expect(res.body.recipientPhone).toBe("+15551234567");
  });

  it("enforces the free plan's monthly Whisper Link limit", async () => {
    for (let i = 0; i < 3; i++) {
      const res = await request(app)
        .post("/api/whisps")
        .set(asUser(USER_A))
        .send({
          videoUrl: "https://youtu.be/x",
          deliveryMethod: "whisper_link",
          whisperChannel: "email",
          recipientEmail: "friend@example.com",
        });
      expect(res.status).toBe(201);
    }

    const blocked = await request(app)
      .post("/api/whisps")
      .set(asUser(USER_A))
      .send({
        videoUrl: "https://youtu.be/x",
        deliveryMethod: "whisper_link",
        whisperChannel: "email",
        recipientEmail: "friend@example.com",
      });

    expect(blocked.status).toBe(402);
  });

  it("rejects Ghost Boost when the sender has no credits", async () => {
    const res = await request(app)
      .post("/api/whisps")
      .set(asUser(USER_A))
      .send({ videoUrl: "https://youtu.be/x", deliveryMethod: "ghost_boost" });

    expect(res.status).toBe(402);
  });

  it("spends a credit and queues the whisp when Ghost Boost is used", async () => {
    // Prime the user with a boost credit via the profile ensure + a direct update.
    await request(app).get("/api/user/profile").set(asUser(USER_A));
    const before = await getUser(USER_A);
    await db.update(usersTable).set({ boostCredits: 1 }).where(eq(usersTable.id, before.id));

    const res = await request(app)
      .post("/api/whisps")
      .set(asUser(USER_A))
      .send({ videoUrl: "https://youtu.be/x", deliveryMethod: "ghost_boost" });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe("pending");
    expect(res.body.deliveredAt).toBeNull();
    expect(res.body.boostSpendUsd).not.toBeNull();

    const after = await getUser(USER_A);
    expect(after.boostCredits).toBe(0);
  });

  it("accepts Circle Drop whisps without any recipient info", async () => {
    const res = await request(app)
      .post("/api/whisps")
      .set(asUser(USER_A))
      .send({ videoUrl: "https://youtu.be/x", deliveryMethod: "circle_drop", moodTag: "just-because" });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe("delivered");
    expect(res.body.recipientEmail).toBeNull();
  });
});

describe("GET /api/whisps", () => {
  it("only returns whisps belonging to the authenticated user", async () => {
    await request(app)
      .post("/api/whisps")
      .set(asUser(USER_A))
      .send({ videoUrl: "https://youtu.be/a", deliveryMethod: "circle_drop" });
    await request(app)
      .post("/api/whisps")
      .set(asUser(USER_B))
      .send({ videoUrl: "https://youtu.be/b", deliveryMethod: "circle_drop" });

    const res = await request(app).get("/api/whisps").set(asUser(USER_A));
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].videoUrl).toBe("https://youtu.be/a");
  });
});

describe("Reveal flow", () => {
  it("lets the sender request a reveal and the recipient respond", async () => {
    const created = await request(app)
      .post("/api/whisps")
      .set(asUser(USER_A))
      .send({ videoUrl: "https://youtu.be/a", deliveryMethod: "circle_drop" });
    const whispId = created.body.id;

    const revealRequested = await request(app).post(`/api/whisps/${whispId}/reveal`).set(asUser(USER_A));
    expect(revealRequested.status).toBe(200);
    expect(revealRequested.body.revealRequested).toBe(true);

    const responded = await request(app).patch(`/api/whisps/${whispId}/reveal`).send({ accepted: true });
    expect(responded.status).toBe(200);
    expect(responded.body.revealAccepted).toBe(true);
  });

  it("rejects a reveal response when no reveal was requested", async () => {
    const created = await request(app)
      .post("/api/whisps")
      .set(asUser(USER_A))
      .send({ videoUrl: "https://youtu.be/a", deliveryMethod: "circle_drop" });

    const responded = await request(app).patch(`/api/whisps/${created.body.id}/reveal`).send({ accepted: true });
    expect(responded.status).toBe(400);
  });

  it("never exposes sender/recipient PII from the unauthenticated reveal-response endpoint", async () => {
    const created = await request(app)
      .post("/api/whisps")
      .set(asUser(USER_A))
      .send({
        videoUrl: "https://youtu.be/a",
        deliveryMethod: "whisper_link",
        whisperChannel: "email",
        recipientEmail: "recipient@example.com",
      });
    const whispId = created.body.id;

    await request(app).post(`/api/whisps/${whispId}/reveal`).set(asUser(USER_A));
    const responded = await request(app).patch(`/api/whisps/${whispId}/reveal`).send({ accepted: true });

    expect(responded.status).toBe(200);
    expect(responded.body).not.toHaveProperty("senderId");
    expect(responded.body).not.toHaveProperty("recipientEmail");
    expect(responded.body).not.toHaveProperty("recipientPhone");
  });
});

describe("GET /api/public/circle", () => {
  it("lists Circle Drop whisps without exposing sender identity fields", async () => {
    await request(app)
      .post("/api/whisps")
      .set(asUser(USER_A))
      .send({ videoUrl: "https://youtu.be/a", deliveryMethod: "circle_drop", anonymousNote: "hi" });
    await request(app)
      .post("/api/whisps")
      .set(asUser(USER_A))
      .send({
        videoUrl: "https://youtu.be/b",
        deliveryMethod: "whisper_link",
        whisperChannel: "email",
        recipientEmail: "x@example.com",
      });

    const res = await request(app).get("/api/public/circle");
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].videoUrl).toBe("https://youtu.be/a");
    expect(res.body.items[0]).not.toHaveProperty("senderId");
    expect(res.body.items[0]).not.toHaveProperty("recipientEmail");
  });
});
