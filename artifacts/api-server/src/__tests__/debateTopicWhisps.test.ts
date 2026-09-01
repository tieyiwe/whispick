import { describe, it, expect } from "vitest";
import { randomUUID } from "crypto";
import request from "supertest";
import app from "../app";
import { db, notificationsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { TEST_USER_HEADER, clerkGetUserMock } from "./setup";

function asUser(clerkId: string) {
  return { [TEST_USER_HEADER]: clerkId };
}

async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 50));
}

async function createTopic(clerkId: string, topicText = "Is honesty always the best policy?") {
  await request(app).get("/api/user/profile").set(asUser(clerkId));
  const res = await request(app).post("/api/debate-topics").set(asUser(clerkId)).send({ topicText });
  return res.body;
}

describe("POST /api/debate-topics/:id/whisp", () => {
  it("rejects unauthenticated requests", async () => {
    const clerkId = `clerk_dtw_owner_${randomUUID()}`;
    const topic = await createTopic(clerkId);

    const res = await request(app)
      .post(`/api/debate-topics/${topic.id}/whisp`)
      .send({ channel: "email", recipientEmail: "friend@example.com" });
    expect(res.status).toBe(401);
  });

  it("returns 404 for an unknown or retracted topic", async () => {
    const clerkId = `clerk_dtw_owner_${randomUUID()}`;
    await request(app).get("/api/user/profile").set(asUser(clerkId));

    const res = await request(app)
      .post(`/api/debate-topics/${randomUUID()}/whisp`)
      .set(asUser(clerkId))
      .send({ channel: "email", recipientEmail: "friend@example.com" });
    expect(res.status).toBe(404);
  });

  it("requires a recipient email when the channel is email", async () => {
    const clerkId = `clerk_dtw_owner_${randomUUID()}`;
    const topic = await createTopic(clerkId);

    const res = await request(app).post(`/api/debate-topics/${topic.id}/whisp`).set(asUser(clerkId)).send({ channel: "email" });
    expect(res.status).toBe(400);
  });

  it("requires a recipient phone when the channel is sms or whatsapp", async () => {
    const clerkId = `clerk_dtw_owner_${randomUUID()}`;
    const topic = await createTopic(clerkId);

    const res = await request(app).post(`/api/debate-topics/${topic.id}/whisp`).set(asUser(clerkId)).send({ channel: "sms" });
    expect(res.status).toBe(400);
  });

  it("lets any signed-in viewer whisp a topic, not just its author", async () => {
    const ownerClerkId = `clerk_dtw_owner_${randomUUID()}`;
    const viewerClerkId = `clerk_dtw_viewer_${randomUUID()}`;
    const topic = await createTopic(ownerClerkId);
    await request(app).get("/api/user/profile").set(asUser(viewerClerkId));

    const res = await request(app)
      .post(`/api/debate-topics/${topic.id}/whisp`)
      .set(asUser(viewerClerkId))
      .send({ channel: "email", recipientEmail: "friend@example.com", note: "You'd have opinions on this" });

    expect(res.status).toBe(201);
    expect(res.body.debateTopicId).toBe(topic.id);
    expect(res.body.channel).toBe("email");
    expect(res.body.recipientEmail).toBe("friend@example.com");
    expect(res.body.note).toBe("You'd have opinions on this");
    // The real send is fire-and-forget with no SMTP configured in this test
    // env, so it resolves to "failed" almost immediately — same caveat
    // invites.test.ts documents for its own equivalent assertion.
    expect(["sent", "failed"]).toContain(res.body.status);
  });

  it("delivers in-app (in addition to the real send) when the recipient email matches a verified account", async () => {
    const senderClerkId = `clerk_dtw_sender_${randomUUID()}`;
    const recipientClerkId = `clerk_dtw_recipient_${randomUUID()}`;
    const recipientEmail = `${recipientClerkId}-matched@example.com`;

    clerkGetUserMock.mockResolvedValueOnce({
      twoFactorEnabled: true,
      emailAddresses: [{ id: "em_1", emailAddress: recipientEmail }],
      primaryEmailAddressId: "em_1",
      phoneNumbers: [],
      firstName: null,
      lastName: null,
    } as any);
    const recipientProfile = await request(app).get("/api/user/profile").set(asUser(recipientClerkId));
    expect(recipientProfile.body.email).toBe(recipientEmail);

    const topic = await createTopic(senderClerkId);
    const res = await request(app)
      .post(`/api/debate-topics/${topic.id}/whisp`)
      .set(asUser(senderClerkId))
      .send({ channel: "email", recipientEmail });
    expect(res.status).toBe(201);
    await settle();

    const notifications = await db.select().from(notificationsTable).where(eq(notificationsTable.targetUserId, recipientProfile.body.id));
    expect(notifications.some((n) => n.title.includes("New Debate Now topic"))).toBe(true);
  });
});

describe("Debate topic whisp rate limiting", () => {
  it("caps how many topic whisps a single user can send per hour", async () => {
    const clerkId = `clerk_dtw_limit_${randomUUID()}`;
    const topic = await createTopic(clerkId);

    let lastStatus = 0;
    for (let i = 0; i < 21; i++) {
      const res = await request(app)
        .post(`/api/debate-topics/${topic.id}/whisp`)
        .set(asUser(clerkId))
        .send({ channel: "email", recipientEmail: `friend${i}@example.com` });
      lastStatus = res.status;
    }
    expect(lastStatus).toBe(429);
  });
});
