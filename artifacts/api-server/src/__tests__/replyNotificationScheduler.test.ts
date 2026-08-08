import { describe, it, expect } from "vitest";
import request from "supertest";
import { randomUUID } from "crypto";
import app from "../app";
import { db, whispRepliesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { TEST_USER_HEADER } from "./setup";
import { getDueReplyNotifications } from "../lib/replyNotificationScheduler";

const USER_A = "clerk_user_reply_sched";

async function createWhisp() {
  const res = await request(app)
    .post("/api/whisps")
    .set(TEST_USER_HEADER, USER_A)
    .send({ videoUrl: "https://youtu.be/x", deliveryMethod: "circle_drop" });
  return res.body as { id: string; publicToken: string };
}

// The scheduler itself is a setInterval loop with no seam to fast-forward
// (same as lib/scheduler.ts and lib/reminderScheduler.ts, neither of which
// has a test file) — but its due-row selection query is pulled out as
// getDueReplyNotifications() specifically so this logic, the part that
// actually matters for correctness, can be verified without waiting on real
// time or the interval firing.
describe("getDueReplyNotifications", () => {
  it("only returns fromRecipient replies whose notifySenderAt has passed and haven't been notified yet", async () => {
    const whisp = await createWhisp();
    const now = Date.now();

    const due = { id: randomUUID(), whispId: whisp.id, replyText: "due", fromRecipient: true, notifySenderAt: new Date(now - 60_000) };
    const notYetDue = { id: randomUUID(), whispId: whisp.id, replyText: "not yet", fromRecipient: true, notifySenderAt: new Date(now + 60_000) };
    const alreadyNotified = {
      id: randomUUID(),
      whispId: whisp.id,
      replyText: "already handled",
      fromRecipient: true,
      notifySenderAt: new Date(now - 60_000),
      senderNotifiedAt: new Date(now - 30_000),
    };
    const senderFollowUp = { id: randomUUID(), whispId: whisp.id, replyText: "sender follow-up", fromRecipient: false };

    await db.insert(whispRepliesTable).values([due, notYetDue, alreadyNotified, senderFollowUp]);

    const result = await getDueReplyNotifications();
    const ids = result.map((r) => r.id);

    expect(ids).toContain(due.id);
    expect(ids).not.toContain(notYetDue.id);
    expect(ids).not.toContain(alreadyNotified.id);
    expect(ids).not.toContain(senderFollowUp.id);
  });

  it("reflects the reply created through the public reply endpoint once its delay elapses", async () => {
    const whisp = await createWhisp();

    const res = await request(app).post(`/api/public/w/${whisp.publicToken}/reply`).send({ replyText: "thank you" });
    expect(res.status).toBe(201);

    // Not due yet — notifySenderAt is 3/5/9 minutes in the future.
    expect(await getDueReplyNotifications()).toHaveLength(0);

    // Backdate it, as if the delay had elapsed, and confirm it becomes due.
    await db
      .update(whispRepliesTable)
      .set({ notifySenderAt: new Date(Date.now() - 1000) })
      .where(eq(whispRepliesTable.id, res.body.id));

    const due = await getDueReplyNotifications();
    expect(due.map((r) => r.id)).toContain(res.body.id);
  });
});
