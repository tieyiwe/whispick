import { describe, it, expect, vi, beforeEach } from "vitest";
import { randomUUID } from "crypto";
import request from "supertest";
import app from "../app";
import { db, usersTable, whispsTable, uploadedVideosTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { TEST_USER_HEADER } from "./setup";

const objectStorageMock = vi.hoisted(() => ({
  uploadObject: vi.fn(async () => true),
  downloadObject: vi.fn(async () => Buffer.from("fake-video-bytes")),
  deleteObject: vi.fn(async () => undefined),
}));

vi.mock("../lib/objectStorage", () => objectStorageMock);

beforeEach(() => {
  objectStorageMock.downloadObject.mockClear().mockResolvedValue(Buffer.from("fake-video-bytes"));
});

function asUser(clerkId: string) {
  return { [TEST_USER_HEADER]: clerkId };
}

// Fresh ids per test: several limiters are in-memory and keyed per user for
// the lifetime of this file.
function freshClerkId(label: string) {
  return `clerk_inbox_${label}_${randomUUID()}`;
}

async function ensure(clerkId: string) {
  await request(app).get("/api/user/profile").set(asUser(clerkId));
  return db.select().from(usersTable).where(eq(usersTable.clerkId, clerkId)).then((r) => r[0]!);
}

// A whisper_link matched to an existing account — ensureUser gives every
// test user `${clerkId}@blindwhisper.com`.
async function sendMatchedWhisp(senderClerkId: string, recipientClerkId: string, extra: Record<string, unknown> = {}) {
  await ensure(senderClerkId);
  await ensure(recipientClerkId);
  const res = await request(app)
    .post("/api/whisps")
    .set(asUser(senderClerkId))
    .send({
      videoUrl: "https://youtu.be/dQw4w9WgXcQ",
      deliveryMethod: "whisper_link",
      whisperChannel: "email",
      recipientEmail: `${recipientClerkId}@blindwhisper.com`,
      ...extra,
    });
  expect(res.status).toBe(201);
  return res.body as { id: string; publicToken: string };
}

// The smallest well-formed MP4 (same fixture as media.test.ts).
function tinyMp4() {
  return Buffer.from("00000010667479706d703432000000000000000" + "86d6f6f76", "hex");
}

async function uploadVideo(clerkId: string) {
  const res = await request(app)
    .post("/api/media/upload")
    .set(asUser(clerkId))
    .field("durationSeconds", "30")
    .attach("video", tinyMp4(), { filename: "clip.mp4", contentType: "video/mp4" });
  expect(res.status).toBe(201);
  return res.body as { id: string };
}

async function receivedState(clerkId: string) {
  const [list, count] = await Promise.all([
    request(app).get("/api/whisps?box=received").set(asUser(clerkId)),
    request(app).get("/api/whisps/received-unread-count").set(asUser(clerkId)),
  ]);
  expect(list.status).toBe(200);
  expect(count.status).toBe(200);
  const unreadInList = (list.body as Array<{ unread: boolean }>).filter((w) => w.unread).length;
  return { list: list.body as Array<{ id: string; unread: boolean; viewerRole: string }>, unreadInList, unreadCount: count.body.unreadCount as number };
}

// The nav badge (/received-unread-count) and the Received tab (its list's
// `unread` flags) used to be computed separately and could disagree — the
// reported symptom was "Received shows 1 but I read everything". Every test
// here asserts both agree, on top of what each one checks.
describe("Received box: unread count matches the list", () => {
  it("a fresh received whisp is unread in both, and opening it clears both", async () => {
    const sender = freshClerkId("open_sender");
    const recipient = freshClerkId("open_recipient");
    const sent = await sendMatchedWhisp(sender, recipient);

    let state = await receivedState(recipient);
    expect(state.list).toHaveLength(1);
    expect(state.list[0]!.unread).toBe(true);
    expect(state.unreadCount).toBe(1);
    expect(state.unreadInList).toBe(1);

    await request(app).post(`/api/public/w/${sent.publicToken}/track`).send({ eventType: "opened" });

    state = await receivedState(recipient);
    expect(state.list).toHaveLength(1);
    expect(state.list[0]!.unread).toBe(false);
    expect(state.unreadCount).toBe(0);
    expect(state.unreadInList).toBe(0);
  });

  it("a whisp sent to your OWN address never shows up in Received or its count", async () => {
    // Previously listed in Received AND counted as unread, but resolved as
    // the sender's own (viewerRole "sender") — its card linked to the
    // sender's detail page, which never records an open, so the badge
    // could never be cleared.
    const me = freshClerkId("self");
    await ensure(me);
    const sent = await sendMatchedWhisp(me, me);
    const [row] = await db.select().from(whispsTable).where(eq(whispsTable.id, sent.id));
    expect(row!.recipientUserId).toBe(row!.senderId);

    const state = await receivedState(me);
    expect(state.list).toHaveLength(0);
    expect(state.unreadCount).toBe(0);

    // Still in Sent, as the sender's.
    const sentBox = await request(app).get("/api/whisps").set(asUser(me));
    expect(sentBox.body.map((w: { id: string }) => w.id)).toEqual([sent.id]);
    expect(sentBox.body[0].viewerRole).toBe("sender");
    expect(sentBox.body[0].unread).toBe(false);

    // Archiving it archives the SENDER copy, and it shows up in Archived once.
    await request(app).post(`/api/whisps/${sent.id}/archive`).set(asUser(me));
    const archived = await request(app).get("/api/whisps?box=archived").set(asUser(me));
    expect(archived.body.map((w: { id: string }) => w.id)).toEqual([sent.id]);
  });

  it("an expired whisp that was never opened stays listed but no longer counts as unread", async () => {
    // POST /public/w/:token/track ignores an expired whisp, so its openedAt
    // can never be set — it used to sit in the badge forever.
    const sender = freshClerkId("exp_sender");
    const recipient = freshClerkId("exp_recipient");
    const expired = await sendMatchedWhisp(sender, recipient);
    await sendMatchedWhisp(sender, recipient);
    await db.update(whispsTable).set({ expiresAt: new Date(Date.now() - 60_000) }).where(eq(whispsTable.id, expired.id));

    const state = await receivedState(recipient);
    expect(state.list).toHaveLength(2);
    expect(state.list.find((w) => w.id === expired.id)!.unread).toBe(false);
    expect(state.unreadCount).toBe(1);
    expect(state.unreadInList).toBe(1);

    // Opening it can't change that, and doesn't need to.
    await request(app).post(`/api/public/w/${expired.publicToken}/track`).send({ eventType: "opened" });
    expect((await receivedState(recipient)).unreadCount).toBe(1);
  });

  it("archiving an unread received whisp moves it out of Received and out of the count; unarchiving restores both", async () => {
    const sender = freshClerkId("arch_sender");
    const recipient = freshClerkId("arch_recipient");
    const sent = await sendMatchedWhisp(sender, recipient);

    await request(app).post(`/api/whisps/${sent.id}/archive`).set(asUser(recipient));
    let state = await receivedState(recipient);
    expect(state.list).toHaveLength(0);
    expect(state.unreadCount).toBe(0);
    const archived = await request(app).get("/api/whisps?box=archived").set(asUser(recipient));
    expect(archived.body.map((w: { id: string }) => w.id)).toEqual([sent.id]);
    expect(archived.body[0].viewerRole).toBe("recipient");
    expect(archived.body[0].archived).toBe(true);

    // The sender's own Sent box is untouched by the recipient's archive.
    const senderSent = await request(app).get("/api/whisps").set(asUser(sender));
    expect(senderSent.body.map((w: { id: string }) => w.id)).toEqual([sent.id]);
    expect(senderSent.body[0].archived).toBe(false);

    await request(app).post(`/api/whisps/${sent.id}/archive`).set(asUser(recipient));
    state = await receivedState(recipient);
    expect(state.list).toHaveLength(1);
    expect(state.unreadCount).toBe(1);
    expect(state.unreadInList).toBe(1);
  });

  it("removed and scheduled whisps stay out of both", async () => {
    const sender = freshClerkId("hidden_sender");
    const recipient = freshClerkId("hidden_recipient");
    const removed = await sendMatchedWhisp(sender, recipient);
    await sendMatchedWhisp(sender, recipient, { scheduledAt: new Date(Date.now() + 60 * 60 * 1000).toISOString() });
    await db.update(whispsTable).set({ removedByAdminAt: new Date() }).where(eq(whispsTable.id, removed.id));

    const state = await receivedState(recipient);
    expect(state.list).toHaveLength(0);
    expect(state.unreadCount).toBe(0);
  });

  it("a sender never sees an unread flag on their own whisps", async () => {
    const sender = freshClerkId("flag_sender");
    const recipient = freshClerkId("flag_recipient");
    await sendMatchedWhisp(sender, recipient);
    const sentBox = await request(app).get("/api/whisps").set(asUser(sender));
    expect(sentBox.body[0].unread).toBe(false);
    expect(sentBox.body[0]).not.toHaveProperty("recipientUserId");
  });
});

describe("Archived box ordering", () => {
  it("sorts by the caller's own pin, then the caller's own archive time — never the other party's", async () => {
    const me = freshClerkId("order_me");
    const other = freshClerkId("order_other");
    const first = await sendMatchedWhisp(me, other);
    const second = await sendMatchedWhisp(me, other);
    const third = await sendMatchedWhisp(me, other);

    // I archive first, then second, then third (third is my newest archive).
    const base = Date.now() - 60 * 60 * 1000;
    await db.update(whispsTable).set({ senderArchivedAt: new Date(base) }).where(eq(whispsTable.id, first.id));
    await db.update(whispsTable).set({ senderArchivedAt: new Date(base + 1000) }).where(eq(whispsTable.id, second.id));
    await db.update(whispsTable).set({ senderArchivedAt: new Date(base + 2000) }).where(eq(whispsTable.id, third.id));
    // The recipient archiving `first` much later must not pull it up MY list.
    await db.update(whispsTable).set({ recipientArchivedAt: new Date() }).where(eq(whispsTable.id, first.id));

    let archived = await request(app).get("/api/whisps?box=archived").set(asUser(me));
    expect(archived.body.map((w: { id: string }) => w.id)).toEqual([third.id, second.id, first.id]);

    // Pinning from the Archived tab floats it to the top there.
    await request(app).post(`/api/whisps/${first.id}/pin`).set(asUser(me));
    archived = await request(app).get("/api/whisps?box=archived").set(asUser(me));
    expect(archived.body.map((w: { id: string }) => w.id)).toEqual([first.id, third.id, second.id]);
    expect(archived.body[0].pinned).toBe(true);
  });
});

describe("Sender keeps access to the video they sent", () => {
  async function sendUploadWhisp(sender: string, recipient: string) {
    const media = await uploadVideo(sender);
    const sent = await sendMatchedWhisp(sender, recipient, { videoUrl: undefined, uploadedVideoId: media.id });
    return { ...sent, mediaId: media.id };
  }

  it("streams an uploaded video to its sender after the recipient's link has expired", async () => {
    const sender = freshClerkId("media_sender");
    const recipient = freshClerkId("media_recipient");
    const sent = await sendUploadWhisp(sender, recipient);
    await db.update(whispsTable).set({ expiresAt: new Date(Date.now() - 60_000), openedAt: new Date(), status: "replied" }).where(eq(whispsTable.id, sent.id));

    // The recipient-facing stream is gone, as before…
    const publicStream = await request(app).get(`/api/public/w/${sent.publicToken}/media`);
    expect(publicStream.status).toBe(410);

    // …but the sender's own route still serves it, archived or not.
    const own = await request(app).get(`/api/whisps/${sent.id}/media`).set(asUser(sender));
    expect(own.status).toBe(200);
    await request(app).post(`/api/whisps/${sent.id}/archive`).set(asUser(sender));
    const ownArchived = await request(app).get(`/api/whisps/${sent.id}/media`).set(asUser(sender));
    expect(ownArchived.status).toBe(200);
  });

  it("is sender-only: the recipient, a stranger and an anonymous caller get nothing", async () => {
    const sender = freshClerkId("own_sender");
    const recipient = freshClerkId("own_recipient");
    const stranger = freshClerkId("own_stranger");
    await ensure(stranger);
    const sent = await sendUploadWhisp(sender, recipient);

    expect((await request(app).get(`/api/whisps/${sent.id}/media`).set(asUser(recipient))).status).toBe(404);
    expect((await request(app).get(`/api/whisps/${sent.id}/media`).set(asUser(stranger))).status).toBe(404);
    expect((await request(app).get(`/api/whisps/${sent.id}/media`)).status).toBe(401);
  });

  it("is refused once a moderator takes the whisp down, and the sender's views say so", async () => {
    const sender = freshClerkId("mod_sender");
    const recipient = freshClerkId("mod_recipient");
    const sent = await sendUploadWhisp(sender, recipient);
    await db.update(whispsTable).set({ removedByAdminAt: new Date() }).where(eq(whispsTable.id, sent.id));

    expect((await request(app).get(`/api/whisps/${sent.id}/media`).set(asUser(sender))).status).toBe(404);
    expect((await request(app).get(`/api/whisps/${sent.id}/media/thumbnail`).set(asUser(sender))).status).toBe(404);
    const list = await request(app).get("/api/whisps").set(asUser(sender));
    expect(list.body[0].contentRemoved).toBe(true);
    const detail = await request(app).get(`/api/whisps/${sent.id}`).set(asUser(sender));
    expect(detail.body.whisp.contentRemoved).toBe(true);
  });

  it("410s once the upload itself has been phased out by media retention", async () => {
    const sender = freshClerkId("ret_sender");
    const recipient = freshClerkId("ret_recipient");
    const sent = await sendUploadWhisp(sender, recipient);
    await db.update(uploadedVideosTable).set({ status: "expired", deletedAt: new Date() }).where(eq(uploadedVideosTable.id, sent.mediaId));

    expect((await request(app).get(`/api/whisps/${sent.id}/media`).set(asUser(sender))).status).toBe(410);
  });

  it("reports contentRemoved false for an ordinary whisp", async () => {
    const sender = freshClerkId("plain_sender");
    const recipient = freshClerkId("plain_recipient");
    const sent = await sendMatchedWhisp(sender, recipient);
    const detail = await request(app).get(`/api/whisps/${sent.id}`).set(asUser(sender));
    expect(detail.body.whisp.contentRemoved).toBe(false);
    expect(detail.body.whisp.videoUrl).toBe("https://youtu.be/dQw4w9WgXcQ");
  });
});
