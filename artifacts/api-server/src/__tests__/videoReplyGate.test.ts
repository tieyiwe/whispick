import { describe, it, expect } from "vitest";
import request from "supertest";
import app from "../app";
import { db, whispsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { TEST_USER_HEADER } from "./setup";
import { getDueVideoReplyRequests } from "../lib/replyNotificationScheduler";

const SENDER = "clerk_user_video_gate";
const RECIPIENT_MEMBER = "clerk_user_video_gate_member";

async function createWhisp(overrides: Record<string, unknown> = {}) {
  const res = await request(app)
    .post("/api/whisps")
    .set(TEST_USER_HEADER, SENDER)
    .send({ videoUrl: "https://youtu.be/x", deliveryMethod: "circle_drop", ...overrides });
  expect(res.status).toBe(201);
  return res.body as { id: string; publicToken: string };
}

async function grantReplyCredits(whispId: string, credits: number) {
  await db.update(whispsTable).set({ replyCreditsPurchased: credits }).where(eq(whispsTable.id, whispId));
}

// Text replies stay open to anonymous recipients; whisping a VIDEO back needs
// either an account or credit the sender bought. Enforced server-side because
// this route is unauthenticated — the UI gate is a courtesy, this is the rule.
describe("video replies from anonymous recipients", () => {
  it("still accepts a text-only reply", async () => {
    const whisp = await createWhisp();
    const res = await request(app).post(`/api/public/w/${whisp.publicToken}/reply`).send({ replyText: "thank you" });
    expect(res.status).toBe(201);
  });

  it("refuses a video reply and says why", async () => {
    const whisp = await createWhisp();
    const res = await request(app)
      .post(`/api/public/w/${whisp.publicToken}/reply`)
      .send({ videoUrl: "https://youtu.be/reply" });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("video_reply_requires_membership");
  });

  it("allows it once the sender has bought reply credit", async () => {
    const whisp = await createWhisp();
    await grantReplyCredits(whisp.id, 1);

    const res = await request(app)
      .post(`/api/public/w/${whisp.publicToken}/reply`)
      .send({ videoUrl: "https://youtu.be/reply" });
    expect(res.status).toBe(201);
  });

  it("allows it for a recipient who signed up, with no credit needed", async () => {
    const whisp = await createWhisp();
    const res = await request(app)
      .post(`/api/public/w/${whisp.publicToken}/reply`)
      .set(TEST_USER_HEADER, RECIPIENT_MEMBER)
      .send({ videoUrl: "https://youtu.be/reply" });
    expect(res.status).toBe(201);
  });

  it("reports the capability on the public page so the UI can gate it", async () => {
    const whisp = await createWhisp();
    const locked = await request(app).get(`/api/public/w/${whisp.publicToken}`);
    expect(locked.body.videoRepliesAllowed).toBe(false);

    await grantReplyCredits(whisp.id, 2);
    const unlocked = await request(app).get(`/api/public/w/${whisp.publicToken}`);
    expect(unlocked.body.videoRepliesAllowed).toBe(true);
  });
});

describe("telling the sender their recipient wanted to send a video", () => {
  it("queues a deferred notification when the attempt is blocked", async () => {
    const whisp = await createWhisp();
    await request(app).post(`/api/public/w/${whisp.publicToken}/video-reply-request`).expect(204);

    const due = await db.select().from(whispsTable).where(eq(whispsTable.id, whisp.id)).then((r) => r[0]);
    expect(due!.videoReplyRequestNotifyAt).not.toBeNull();

    // Deferred, never immediate — the trigger is a recipient action, so an
    // instant push would tie the sender's buzzing phone to the recipient
    // beside them (the same reason reply notifications are delayed).
    const deltaMinutes = Math.round(
      (due!.videoReplyRequestNotifyAt!.getTime() - Date.now()) / 60_000,
    );
    expect([3, 5, 9]).toContain(deltaMinutes);
    expect(due!.videoReplyRequestNotifiedAt).toBeNull();
  });

  it("records one notification no matter how many times the locked button is tapped", async () => {
    const whisp = await createWhisp();
    await request(app).post(`/api/public/w/${whisp.publicToken}/video-reply-request`).expect(204);
    const first = await db.select().from(whispsTable).where(eq(whispsTable.id, whisp.id)).then((r) => r[0]);

    for (let i = 0; i < 5; i++) {
      await request(app).post(`/api/public/w/${whisp.publicToken}/video-reply-request`).expect(204);
    }

    const after = await db.select().from(whispsTable).where(eq(whispsTable.id, whisp.id)).then((r) => r[0]);
    // Unchanged: an unauthenticated endpoint must not let a recipient drive a
    // notification per tap at the sender.
    expect(after!.videoReplyRequestNotifyAt?.getTime()).toBe(first!.videoReplyRequestNotifyAt?.getTime());
  });

  it("records nothing when the sender has already unlocked video replies", async () => {
    const whisp = await createWhisp();
    await grantReplyCredits(whisp.id, 1);

    await request(app).post(`/api/public/w/${whisp.publicToken}/video-reply-request`).expect(204);

    const row = await db.select().from(whispsTable).where(eq(whispsTable.id, whisp.id)).then((r) => r[0]);
    expect(row!.videoReplyRequestNotifyAt).toBeNull();
  });

  it("answers an unknown token the same way, so it can't be used to probe tokens", async () => {
    await request(app).post("/api/public/w/does-not-exist/video-reply-request").expect(204);
  });

  it("is picked up by the scheduler only once its deferral has elapsed", async () => {
    const whisp = await createWhisp();
    await request(app).post(`/api/public/w/${whisp.publicToken}/video-reply-request`).expect(204);

    expect(await getDueVideoReplyRequests()).toHaveLength(0);

    await db
      .update(whispsTable)
      .set({ videoReplyRequestNotifyAt: new Date(Date.now() - 60_000) })
      .where(eq(whispsTable.id, whisp.id));

    const due = await getDueVideoReplyRequests();
    expect(due.map((w) => w.id)).toContain(whisp.id);
  });
});
