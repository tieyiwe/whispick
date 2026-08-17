import { describe, it, expect } from "vitest";
import request from "supertest";
import app from "../app";
import { db, whispsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { TEST_USER_HEADER } from "./setup";

const USER_A = "clerk_expiration_sender";

function asUser(userId: string) {
  return { [TEST_USER_HEADER]: userId };
}

async function createWhisperLinkWhisp() {
  const res = await request(app)
    .post("/api/whisps")
    .set(asUser(USER_A))
    .send({
      videoUrl: "https://youtu.be/x",
      deliveryMethod: "whisper_link",
      whisperChannel: "email",
      recipientEmail: "friend@example.com",
    });
  return res.body as { id: string; publicToken: string };
}

async function createCircleDropWhisp() {
  const res = await request(app)
    .post("/api/whisps")
    .set(asUser(USER_A))
    .send({ videoUrl: "https://youtu.be/x", deliveryMethod: "circle_drop" });
  return res.body as { id: string; publicToken: string };
}

async function expireWhisp(id: string) {
  await db.update(whispsTable).set({ expiresAt: new Date(Date.now() - 60_000) }).where(eq(whispsTable.id, id));
}

describe("whisp expiration", () => {
  it("sets an expiresAt roughly 48 hours out for a whisper_link send, and none for circle_drop", async () => {
    const linked = await createWhisperLinkWhisp();
    expect(linked.id).toBeTruthy();

    const linkedPublic = await request(app).get(`/api/public/w/${linked.publicToken}`);
    expect(linkedPublic.body.expired).toBe(false);
    expect(linkedPublic.body.reminderCount).toBe(0);
    const hoursOut = (new Date(linkedPublic.body.expiresAt).getTime() - Date.now()) / (60 * 60 * 1000);
    expect(hoursOut).toBeGreaterThan(47);
    expect(hoursOut).toBeLessThan(49);

    const dropped = await createCircleDropWhisp();
    const droppedPublic = await request(app).get(`/api/public/w/${dropped.publicToken}`);
    expect(droppedPublic.body.expiresAt).toBeNull();
    expect(droppedPublic.body.expired).toBe(false);
  });

  it("marks the public page as expired once expiresAt has passed", async () => {
    const whisp = await createWhisperLinkWhisp();
    await expireWhisp(whisp.id);

    const res = await request(app).get(`/api/public/w/${whisp.publicToken}`);
    expect(res.body.expired).toBe(true);
  });

  it("silently no-ops tracking events for an expired whisp instead of erroring", async () => {
    const whisp = await createWhisperLinkWhisp();
    await expireWhisp(whisp.id);

    const res = await request(app).post(`/api/public/w/${whisp.publicToken}/track`).send({ eventType: "opened" });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it("rejects a reply to an expired whisp", async () => {
    const whisp = await createWhisperLinkWhisp();
    await expireWhisp(whisp.id);

    const res = await request(app).post(`/api/public/w/${whisp.publicToken}/reply`).send({ replyText: "too late" });
    expect(res.status).toBe(410);
  });

  it("rejects an appreciation response for an expired whisp", async () => {
    const whisp = await createWhisperLinkWhisp();
    await expireWhisp(whisp.id);

    const res = await request(app).post(`/api/public/w/${whisp.publicToken}/appreciation`).send({ appreciated: true });
    expect(res.status).toBe(410);
  });
});

describe("POST /api/public/w/:token/remind-me", () => {
  it("returns 404 for an unknown token", async () => {
    const res = await request(app).post("/api/public/w/does-not-exist/remind-me").send({ minutes: 60 });
    expect(res.status).toBe(404);
  });

  it("rejects reminders for a whisp with no expiration (e.g. circle_drop)", async () => {
    const whisp = await createCircleDropWhisp();
    const res = await request(app).post(`/api/public/w/${whisp.publicToken}/remind-me`).send({ minutes: 60 });
    expect(res.status).toBe(400);
  });

  it("rejects a reminder that would land after the whisp expires", async () => {
    const whisp = await createWhisperLinkWhisp();
    const res = await request(app)
      .post(`/api/public/w/${whisp.publicToken}/remind-me`)
      .send({ minutes: 60 * 24 * 30 }); // 30 days — well past the 48h expiry
    expect(res.status).toBe(400);
  });

  it("schedules a reminder within the valid window", async () => {
    const whisp = await createWhisperLinkWhisp();
    const res = await request(app).post(`/api/public/w/${whisp.publicToken}/remind-me`).send({ minutes: 60 });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.isFinal).toBe(false);
    expect(res.body.nextReminderAt).toBeTruthy();
  });

  it("rejects further reminders once the max has been used up", async () => {
    const whisp = await createWhisperLinkWhisp();
    await db.update(whispsTable).set({ reminderCount: 2 }).where(eq(whispsTable.id, whisp.id));

    const res = await request(app).post(`/api/public/w/${whisp.publicToken}/remind-me`).send({ minutes: 60 });
    expect(res.status).toBe(400);
  });

  it("rejects a reminder request for an already-expired whisp", async () => {
    const whisp = await createWhisperLinkWhisp();
    await expireWhisp(whisp.id);

    const res = await request(app).post(`/api/public/w/${whisp.publicToken}/remind-me`).send({ minutes: 60 });
    expect(res.status).toBe(410);
  });
});
