import { describe, it, expect } from "vitest";
import { randomUUID } from "crypto";
import request from "supertest";
import app from "../app";
import { TEST_USER_HEADER } from "./setup";

function asUser(clerkId: string) {
  return { [TEST_USER_HEADER]: clerkId };
}

describe("Guess who sent it", () => {
  it("lets the anonymous recipient flag a reply as a guess, and never auto-checks it", async () => {
    const sender = `clerk_guess_sender_${randomUUID()}`;

    const created = await request(app)
      .post("/api/whisps")
      .set(asUser(sender))
      .send({ videoUrl: "https://youtu.be/dQw4w9WgXcQ", deliveryMethod: "circle_drop" });
    expect(created.status).toBe(201);
    const { id: whispId, publicToken } = created.body;

    const guess = await request(app)
      .post(`/api/public/w/${publicToken}/reply`)
      .send({ replyText: "I bet this was my coworker Sam", isGuess: true });
    expect(guess.status).toBe(201);
    expect(guess.body.isGuess).toBe(true);
    expect(guess.body.guessReaction).toBeNull();

    // The sender's own view shows the guess with no reaction yet — nothing
    // in this response path ever compares the guess text to the real sender.
    const sendersReplies = await request(app).get(`/api/whisps/${whispId}/replies`).set(asUser(sender));
    expect(sendersReplies.status).toBe(200);
    const stored = sendersReplies.body.find((r: { id: string }) => r.id === guess.body.id);
    expect(stored.isGuess).toBe(true);
    expect(stored.guessReaction).toBeNull();
  });

  it("rejects a guess with no text", async () => {
    const sender = `clerk_guess_sender_${randomUUID()}`;
    const created = await request(app)
      .post("/api/whisps")
      .set(asUser(sender))
      .send({ videoUrl: "https://youtu.be/dQw4w9WgXcQ", deliveryMethod: "circle_drop" });
    const { publicToken } = created.body;

    const guess = await request(app)
      .post(`/api/public/w/${publicToken}/reply`)
      .send({ isGuess: true });
    expect(guess.status).toBe(400);
  });

  it("only the whisp's own sender can set a guess reaction, and only on an actual guess", async () => {
    const sender = `clerk_guess_sender_${randomUUID()}`;
    const stranger = `clerk_guess_stranger_${randomUUID()}`;

    const created = await request(app)
      .post("/api/whisps")
      .set(asUser(sender))
      .send({ videoUrl: "https://youtu.be/dQw4w9WgXcQ", deliveryMethod: "circle_drop" });
    const { id: whispId, publicToken } = created.body;

    const guess = await request(app)
      .post(`/api/public/w/${publicToken}/reply`)
      .send({ replyText: "Was it my sister?", isGuess: true });
    const guessId = guess.body.id;

    const ordinaryReply = await request(app)
      .post(`/api/public/w/${publicToken}/reply`)
      .send({ replyText: "just a normal reply, not a guess" });
    const ordinaryReplyId = ordinaryReply.body.id;

    // A different signed-in user can't touch someone else's whisp.
    const stolen = await request(app)
      .patch(`/api/whisps/${whispId}/replies/${guessId}/guess-reaction`)
      .set(asUser(stranger))
      .send({ reaction: "hot" });
    expect(stolen.status).toBe(404);

    // Only real guesses accept a reaction — an ordinary reply can't be
    // reacted to through this endpoint even by the real sender.
    const wrongTarget = await request(app)
      .patch(`/api/whisps/${whispId}/replies/${ordinaryReplyId}/guess-reaction`)
      .set(asUser(sender))
      .send({ reaction: "confirmed" });
    expect(wrongTarget.status).toBe(404);

    const invalidReaction = await request(app)
      .patch(`/api/whisps/${whispId}/replies/${guessId}/guess-reaction`)
      .set(asUser(sender))
      .send({ reaction: "definitely_yes" });
    expect(invalidReaction.status).toBe(400);

    const reacted = await request(app)
      .patch(`/api/whisps/${whispId}/replies/${guessId}/guess-reaction`)
      .set(asUser(sender))
      .send({ reaction: "hot" });
    expect(reacted.status).toBe(200);
    expect(reacted.body.guessReaction).toBe("hot");

    // The recipient can see the sender's reaction on their own guess, via the
    // safe column list that also strips notifySenderAt/senderNotifiedAt.
    const recipientView = await request(app).get(`/api/public/w/${publicToken}`);
    const recipientsCopy = recipientView.body.replies.find((r: { id: string }) => r.id === guessId);
    expect(recipientsCopy.guessReaction).toBe("hot");
    expect(recipientsCopy).not.toHaveProperty("notifySenderAt");

    // Reacting again overwrites rather than stacking.
    const changed = await request(app)
      .patch(`/api/whisps/${whispId}/replies/${guessId}/guess-reaction`)
      .set(asUser(sender))
      .send({ reaction: "confirmed" });
    expect(changed.body.guessReaction).toBe("confirmed");
  });
});
