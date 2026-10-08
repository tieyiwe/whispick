import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";
import { randomUUID } from "crypto";
import sharp from "sharp";
import app from "../app";
import {
  db,
  usersTable,
  whispsTable,
  whispRepliesTable,
  notificationsTable,
  circleCommentsTable,
  matchSubscribersTable,
} from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { TEST_USER_HEADER } from "./setup";
import { resetPublicRouteCountersForTests } from "../routes/public";
import { dispatchDueDeferredNotifications, scheduleDeferredNotification } from "../lib/replyNotificationScheduler";
import { anonymousCommentLimit } from "../lib/plans";
import { isReservedHandle } from "../lib/anonymousHandles";
import { isAllowedFetchUrl, fetchAllowlisted, MAX_SCRAPE_BODY_BYTES } from "../lib/videoMeta";
import { reencodeImage } from "../lib/commentImages";
import { cachedCountryForIp, geoCacheSizeForTests, GEO_CACHE_MAX_ENTRIES } from "../lib/visitorTracking";

const objectStorageMock = vi.hoisted(() => ({
  uploadObject: vi.fn(async (_key: string, _bytes: Buffer) => true),
  downloadObject: vi.fn(async (_key: string) => Buffer.from("stored-bytes")),
  deleteObject: vi.fn(async () => undefined),
}));
vi.mock("../lib/objectStorage", () => objectStorageMock);

const sendEmailMock = vi.hoisted(() => vi.fn(async (..._args: any[]) => true));
vi.mock("../lib/email", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/email")>()),
  sendEmail: sendEmailMock,
}));

vi.mock("../lib/geoip", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/geoip")>()),
  lookupGeoIp: vi.fn(async () => ({ country: "US", region: null, city: null })),
}));

const POSTER = "clerk_secpub_poster";
const OTHER = "clerk_secpub_other";

function asUser(clerkId: string) {
  return { [TEST_USER_HEADER]: clerkId };
}

async function createCirclePost(clerkId = POSTER) {
  const res = await request(app)
    .post("/api/whisps")
    .set(asUser(clerkId))
    .send({ videoUrl: "https://youtu.be/x", deliveryMethod: "circle_drop" });
  expect(res.status).toBe(201);
  return res.body as { id: string; publicToken: string };
}

async function userIdFor(clerkId: string): Promise<string> {
  const user = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.clerkId, clerkId)).then((r) => r[0]);
  return user!.id;
}

// A 1:1 Whisper Link row, inserted directly (no outbound email/SMS send).
async function createOneToOneWhisp(senderId: string, overrides: Partial<typeof whispsTable.$inferInsert> = {}) {
  const id = randomUUID();
  const publicToken = randomUUID().replace(/-/g, "");
  await db.insert(whispsTable).values({
    id,
    senderId,
    videoUrl: "https://youtu.be/y",
    deliveryMethod: "whisper_link",
    publicToken,
    status: "delivered",
    deliveredAt: new Date(),
    expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
    ...overrides,
  });
  return { id, publicToken };
}

async function notificationsFor(userId: string, kind: string) {
  return db
    .select()
    .from(notificationsTable)
    .where(and(eq(notificationsTable.targetUserId, userId), eq(notificationsTable.kind, kind)));
}

function emailsWithPurpose(purpose: string) {
  return sendEmailMock.mock.calls.filter((call) => call[3]?.purpose === purpose);
}

beforeEach(() => {
  resetPublicRouteCountersForTests();
  sendEmailMock.mockClear();
  objectStorageMock.uploadObject.mockClear();
  objectStorageMock.downloadObject.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Blind Circle posts have no shared 1:1 thread", () => {
  it("rejects reply, appreciation and remind-me, and never records a video-reply request", async () => {
    const post = await createCirclePost();
    const base = `/api/public/w/${post.publicToken}`;

    const reply = await request(app).post(`${base}/reply`).send({ replyText: "Is it Sam?", isGuess: true });
    expect(reply.status).toBe(400);
    expect(reply.body.code).toBe("circle_post_no_replies");

    expect((await request(app).post(`${base}/appreciation`).send({ appreciated: true })).status).toBe(400);
    expect((await request(app).post(`${base}/remind-me`).send({ minutes: 30 })).status).toBe(400);

    expect((await request(app).post(`${base}/video-reply-request`)).status).toBe(204);
    const row = await db.select().from(whispsTable).where(eq(whispsTable.id, post.id)).then((r) => r[0]);
    expect(row?.videoReplyRequestNotifyAt).toBeNull();

    const replyRows = await db.select().from(whispRepliesTable).where(eq(whispRepliesTable.whispId, post.id));
    expect(replyRows).toHaveLength(0);
  });

  it("never returns a reply thread (or guess confirmations) for a circle post, even pre-existing rows", async () => {
    const post = await createCirclePost();
    await db.insert(whispRepliesTable).values({
      id: randomUUID(),
      whispId: post.id,
      replyText: "Is it Sam?",
      fromRecipient: true,
      isGuess: true,
      guessReaction: "confirmed",
    });

    const page = await request(app).get(`/api/public/w/${post.publicToken}`);
    expect(page.status).toBe(200);
    expect(page.body.replies).toEqual([]);
    expect(JSON.stringify(page.body)).not.toContain("confirmed");
  });

  it("still allows replies on a 1:1 whisp", async () => {
    await createCirclePost(); // creates the user
    const whisp = await createOneToOneWhisp(await userIdFor(POSTER));
    const reply = await request(app).post(`/api/public/w/${whisp.publicToken}/reply`).send({ replyText: "thank you" });
    expect(reply.status).toBe(201);
  });
});

describe("takedown enforcement", () => {
  it("404s a circle_dm thread (page and media) once its origin post is taken down", async () => {
    const post = await createCirclePost();
    const started = await request(app).post(`/api/public/w/${post.publicToken}/circle-dm/start`);
    expect(started.status).toBe(201);
    const dmToken = started.body.publicToken as string;

    expect((await request(app).get(`/api/public/w/${dmToken}`)).status).toBe(200);

    await db.update(whispsTable).set({ removedByAdminAt: new Date() }).where(eq(whispsTable.id, post.id));

    expect((await request(app).get(`/api/public/w/${dmToken}`)).status).toBe(404);
    expect((await request(app).get(`/api/public/w/${dmToken}/media`)).status).toBe(404);
    expect((await request(app).post(`/api/public/w/${dmToken}/reply`).send({ replyText: "hi" })).status).toBe(404);
  });

  it("404s side endpoints on a taken-down whisp", async () => {
    await createCirclePost();
    const whisp = await createOneToOneWhisp(await userIdFor(POSTER), { removedByAdminAt: new Date() });
    const base = `/api/public/w/${whisp.publicToken}`;
    expect((await request(app).post(`${base}/reply`).send({ replyText: "hi" })).status).toBe(404);
    expect((await request(app).post(`${base}/appreciation`).send({ appreciated: true })).status).toBe(404);
    expect((await request(app).post(`${base}/remind-me`).send({ minutes: 30 })).status).toBe(404);
    expect((await request(app).patch(`${base}/handle`).send({ visitorId: "v1", handle: "QuietRiver123" })).status).toBe(404);
  });

  it("serves a comment image only through its own post's token", async () => {
    const postA = await createCirclePost();
    const postB = await createCirclePost();
    const commentId = randomUUID();
    await db.insert(circleCommentsTable).values({
      id: commentId,
      whispId: postA.id,
      visitorId: "v-img",
      commentText: "pic",
      imageObjectKey: "comment-images/x.png",
      imageModerationStatus: "ok",
    });

    expect((await request(app).get(`/api/public/w/${postB.publicToken}/comments/${commentId}/image`)).status).toBe(404);
    expect((await request(app).get(`/api/public/w/${postA.publicToken}/comments/${commentId}/image`)).status).toBe(200);

    await db.update(whispsTable).set({ removedByAdminAt: new Date() }).where(eq(whispsTable.id, postA.id));
    expect((await request(app).get(`/api/public/w/${postA.publicToken}/comments/${commentId}/image`)).status).toBe(404);
  });
});

describe("POST /w/:token/track", () => {
  it("rejects event types outside the known set", async () => {
    await createCirclePost();
    const whisp = await createOneToOneWhisp(await userIdFor(POSTER));
    const res = await request(app).post(`/api/public/w/${whisp.publicToken}/track`).send({ eventType: "<b>hacked</b>" });
    expect(res.status).toBe(400);
  });
});

describe("deferred sender notifications", () => {
  it("schedules opened/watched for later instead of notifying in the same request", async () => {
    await createCirclePost();
    const senderId = await userIdFor(POSTER);
    const whisp = await createOneToOneWhisp(senderId);

    const before = Date.now();
    await request(app).post(`/api/public/w/${whisp.publicToken}/track`).send({ eventType: "opened" });
    await request(app).post(`/api/public/w/${whisp.publicToken}/track`).send({ eventType: "clicked" });

    for (const kind of ["opened", "watched"]) {
      const rows = await notificationsFor(senderId, kind);
      expect(rows).toHaveLength(1);
      const minutes = Math.round((rows[0]!.deliverAfter!.getTime() - before) / 60_000);
      expect([3, 5, 9]).toContain(minutes);
    }
  });

  it("dispatch releases due rows: clears deliverAfter and resets createdAt", async () => {
    await createCirclePost();
    const senderId = await userIdFor(POSTER);
    await scheduleDeferredNotification(senderId, "t", "b", "/whisps/x", "opened");
    const longAgo = new Date(Date.now() - 60 * 60 * 1000);
    await db
      .update(notificationsTable)
      .set({ deliverAfter: new Date(Date.now() - 1000), createdAt: longAgo })
      .where(eq(notificationsTable.targetUserId, senderId));

    expect(await dispatchDueDeferredNotifications()).toBeGreaterThanOrEqual(1);
    const [row] = await notificationsFor(senderId, "opened");
    expect(row?.deliverAfter).toBeNull();
    expect(row!.createdAt.getTime()).toBeGreaterThan(longAgo.getTime() + 30 * 60 * 1000);
    expect(await dispatchDueDeferredNotifications()).toBe(0); // claimed once
  });

  it("coalesces a burst into one pending notification per (user, kind, url)", async () => {
    await createCirclePost();
    const userId = await userIdFor(POSTER);
    for (let i = 0; i < 5; i++) await scheduleDeferredNotification(userId, "t", "b", "/w/abc", "circle_comment");
    expect(await notificationsFor(userId, "circle_comment")).toHaveLength(1);
  });

  it("defers the appreciation email along with the push", async () => {
    await createCirclePost();
    const senderId = await userIdFor(POSTER);
    const whisp = await createOneToOneWhisp(senderId);

    const res = await request(app).post(`/api/public/w/${whisp.publicToken}/appreciation`).send({ appreciated: true });
    expect(res.status).toBe(200);
    expect(emailsWithPurpose("appreciation_notification")).toHaveLength(0);

    await db.update(notificationsTable).set({ deliverAfter: new Date(Date.now() - 1000) }).where(eq(notificationsTable.targetUserId, senderId));
    await dispatchDueDeferredNotifications();
    expect(emailsWithPurpose("appreciation_notification")).toHaveLength(1);
  });

  it("defers the Whisper Box notification", async () => {
    const enable = await request(app).post("/api/whisper-box/enable").set(asUser(OTHER));
    const send = await request(app).post(`/api/public/whisper-box/${enable.body.handle}`).send({ messageText: "hi there" });
    expect(send.status).toBe(201);
    const [row] = await notificationsFor(await userIdFor(OTHER), "whisper_box");
    expect(row?.deliverAfter).not.toBeNull();
  });
});

describe("comment reactions", () => {
  it("notifies a comment's author at most once per visitor, however often they toggle", async () => {
    const post = await createCirclePost();
    const comment = await request(app)
      .post(`/api/public/w/${post.publicToken}/comments`)
      .set(asUser(OTHER))
      .send({ commentText: "nice", visitorId: "author-visitor" });
    expect(comment.status).toBe(201);
    const authorId = await userIdFor(OTHER);
    const react = (reaction: "like" | "dislike") =>
      request(app).post(`/api/public/w/${post.publicToken}/comments/${comment.body.id}/reactions`).send({ visitorId: "v-reactor", reaction });

    expect((await react("like")).body.viewerReaction).toBe("like");
    expect(await notificationsFor(authorId, "circle_comment_reaction")).toHaveLength(1);
    // Simulate the first one having been delivered, so coalescing isn't
    // what's suppressing the rest.
    await db.update(notificationsTable).set({ deliverAfter: null }).where(eq(notificationsTable.targetUserId, authorId));

    expect((await react("like")).body.viewerReaction).toBeNull(); // un-like
    expect((await react("like")).body).toMatchObject({ viewerReaction: "like", likeCount: 1 });
    expect((await react("dislike")).body).toMatchObject({ viewerReaction: "dislike", likeCount: 0, dislikeCount: 1 });
    expect((await react("like")).body).toMatchObject({ viewerReaction: "like", likeCount: 1, dislikeCount: 0 });

    expect(await notificationsFor(authorId, "circle_comment_reaction")).toHaveLength(1);

    // An un-reacted row counts as neither and reads back as no reaction.
    await react("like");
    const page = await request(app).get(`/api/public/w/${post.publicToken}`).query({ visitorId: "v-reactor" });
    const c = page.body.comments.find((x: any) => x.id === comment.body.id);
    expect(c).toMatchObject({ likeCount: 0, dislikeCount: 0, viewerReaction: null });
  });
});

describe("anonymous comment cap", () => {
  it("can't be bypassed by rotating visitorId from one network", async () => {
    const limit = anonymousCommentLimit();
    if (limit === null) return; // cap disabled in this environment
    const post = await createCirclePost();
    const comment = (ip: string, visitorId: string) =>
      request(app).post(`/api/public/w/${post.publicToken}/comments`).set("X-Forwarded-For", ip).send({ commentText: "spam", visitorId });

    for (let i = 0; i < limit * 3; i++) {
      expect((await comment("203.0.113.7", `rotating-${i}`)).status).toBe(201);
    }
    const blocked = await comment("203.0.113.7", "rotating-fresh");
    expect(blocked.status).toBe(403);
    expect(blocked.body.code).toBe("comment_limit_reached");

    expect((await comment("198.51.100.9", "someone-else")).status).toBe(201);
  });
});

describe("PATCH /w/:token/handle", () => {
  it("only works on circle posts and refuses reserved names", async () => {
    const post = await createCirclePost();
    const whisp = await createOneToOneWhisp(await userIdFor(POSTER));

    expect((await request(app).patch(`/api/public/w/${whisp.publicToken}/handle`).send({ visitorId: "v1", handle: "QuietRiver123" })).status).toBe(400);

    for (const handle of ["OriginalPoster", "poster", "Admin42", "BlindWhisperTeam", "Moderator", "OP"]) {
      const res = await request(app).patch(`/api/public/w/${post.publicToken}/handle`).send({ visitorId: "v1", handle });
      expect(res.status).toBe(400);
    }
    const ok = await request(app).patch(`/api/public/w/${post.publicToken}/handle`).send({ visitorId: "v1", handle: "QuietRiver123" });
    expect(ok.status).toBe(200);
  });

  it("isReservedHandle matches case-insensitively", () => {
    expect(isReservedHandle("originalposter")).toBe(true);
    expect(isReservedHandle("BLINDWHISPER")).toBe(true);
    expect(isReservedHandle("SwiftFalcon482")).toBe(false);
  });
});

describe("upload ids are not published", () => {
  it("returns a bare upload: marker on the public page and the circle feed", async () => {
    await createCirclePost();
    const uploadedVideoId = randomUUID();
    const whisp = await createOneToOneWhisp(await userIdFor(POSTER), {
      deliveryMethod: "circle_drop",
      videoUrl: `upload:${uploadedVideoId}`,
      videoPlatform: "upload",
      uploadedVideoId,
      expiresAt: null,
    });

    const page = await request(app).get(`/api/public/w/${whisp.publicToken}`);
    expect(page.body.videoUrl).toBe("upload:");

    const feed = await request(app).get("/api/public/circle");
    const item = feed.body.items.find((i: any) => i.publicToken === whisp.publicToken);
    expect(item.videoUrl).toBe("upload:");
    expect(JSON.stringify(feed.body)).not.toContain(uploadedVideoId);
  });
});

describe("GET /public/whisper-box/:handle", () => {
  it("never returns the owner's Debate persona avatar", async () => {
    const enable = await request(app).post("/api/whisper-box/enable").set(asUser(OTHER));
    // The owner has a Debate persona avatar...
    await db.update(usersTable).set({ whispererAvatarId: "owl" }).where(eq(usersTable.clerkId, OTHER));
    const res = await request(app).get(`/api/public/whisper-box/${enable.body.handle}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("avatarId", null); // ...but strangers don't see it
  });
});

describe("POST /public/subscribe verification throttle", () => {
  const email = "throttle-target@example.com";
  const subscribe = () => request(app).post("/api/public/subscribe").send({ email, categories: ["music"] });
  const sends = () => emailsWithPurpose("subscription_verification").length;
  const ageLastSend = (minutes: number) =>
    db
      .update(matchSubscribersTable)
      .set({ lastVerificationSentAt: new Date(Date.now() - minutes * 60_000) })
      .where(eq(matchSubscribersTable.email, email));

  it("sends at most one email per 10 minutes and 3 per day per address, silently", async () => {
    expect((await subscribe()).body).toEqual({ ok: true, alreadyVerified: false });
    expect(sends()).toBe(1);

    expect((await subscribe()).body).toEqual({ ok: true, alreadyVerified: false });
    expect(sends()).toBe(1); // inside the gap

    await ageLastSend(11);
    await subscribe();
    expect(sends()).toBe(2);
    await ageLastSend(11);
    await subscribe();
    expect(sends()).toBe(3);
    await ageLastSend(11);
    await subscribe();
    expect(sends()).toBe(3); // daily cap

    await db
      .update(matchSubscribersTable)
      .set({ verificationWindowStartedAt: new Date(Date.now() - 25 * 60 * 60 * 1000) })
      .where(eq(matchSubscribersTable.email, email));
    await subscribe();
    expect(sends()).toBe(4); // new window
  });
});

// --- uploads ---------------------------------------------------------------

function mp4Box(type: string, payload: Buffer): Buffer {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(8 + payload.length, 0);
  header.write(type, 4, "latin1");
  return Buffer.concat([header, payload]);
}

describe("POST /api/media/upload metadata stripping", () => {
  it("stores the video with its GPS/udta metadata neutralized, same length", async () => {
    const gps = "+37.7749-122.4194/";
    const mp4 = Buffer.concat([
      mp4Box("ftyp", Buffer.from("isom\0\0\0\0isom", "latin1")),
      mp4Box("moov", Buffer.concat([mp4Box("mvhd", Buffer.alloc(100, 1).fill(0, 0, 1)), mp4Box("udta", mp4Box("©xyz", Buffer.from(gps, "latin1")))])),
      mp4Box("mdat", Buffer.from("frames")),
    ]);
    const res = await request(app)
      .post("/api/media/upload")
      .set(asUser(POSTER))
      .field("durationSeconds", "10")
      .attach("video", mp4, { filename: "clip.mp4", contentType: "video/mp4" });
    expect(res.status).toBe(201);

    const videoCall = objectStorageMock.uploadObject.mock.calls.find(([key]) => String(key).endsWith("video.mp4"));
    const stored = videoCall![1] as Buffer;
    expect(stored.length).toBe(mp4.length);
    expect(stored.toString("latin1")).not.toContain(gps);
    expect(stored.toString("latin1")).toContain("frames");
  });

  it("rejects a container it can't parse instead of storing it un-stripped", async () => {
    const broken = Buffer.concat([mp4Box("ftyp", Buffer.from("isom\0\0\0\0", "latin1")), Buffer.from("ffffffff6d6f6f76", "hex")]);
    const res = await request(app)
      .post("/api/media/upload")
      .set(asUser(POSTER))
      .field("durationSeconds", "10")
      .attach("video", broken, { filename: "clip.mp4", contentType: "video/mp4" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("video_unprocessable");
    expect(objectStorageMock.uploadObject).not.toHaveBeenCalled();
  });
});

describe("comment image metadata stripping", () => {
  async function jpegWithExif(): Promise<Buffer> {
    return sharp({ create: { width: 8, height: 4, channels: 3, background: "red" } })
      .jpeg()
      .withExif({ IFD0: { Make: "SecretPhoneCo", Model: "Model-GPS" } })
      .toBuffer();
  }

  it("reencodeImage drops EXIF and keeps the format", async () => {
    const original = await jpegWithExif();
    expect((await sharp(original).metadata()).exif).toBeTruthy();
    const clean = await reencodeImage(original, "image/jpeg");
    const meta = await sharp(clean!).metadata();
    expect(meta.format).toBe("jpeg");
    expect(meta.exif).toBeUndefined();
    expect(clean!.toString("latin1")).not.toContain("SecretPhoneCo");
  });

  it("strips an attached comment image before storage, and 400s an undecodable one", async () => {
    const post = await createCirclePost();
    const ok = await request(app)
      .post(`/api/public/w/${post.publicToken}/comments`)
      .field("commentText", "look")
      .field("visitorId", "v-pic")
      .attach("image", await jpegWithExif(), { filename: "p.jpg", contentType: "image/jpeg" });
    expect(ok.status).toBe(201);
    const stored = objectStorageMock.uploadObject.mock.calls.find(([key]) => String(key).startsWith("comment-images/"))![1] as Buffer;
    expect((await sharp(stored).metadata()).exif).toBeUndefined();

    // Right magic bytes, garbage body: can't be re-encoded → rejected, not stored raw.
    const fakePng = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.from("not really a png")]);
    const bad = await request(app)
      .post(`/api/public/w/${post.publicToken}/comments`)
      .field("commentText", "look")
      .field("visitorId", "v-pic2")
      .attach("image", fakePng, { filename: "p.png", contentType: "image/png" });
    expect(bad.status).toBe(400);
  });
});

// --- outbound scraping -----------------------------------------------------

describe("fetchAllowlisted", () => {
  it("allows only https platform hosts, no IP literals", () => {
    expect(isAllowedFetchUrl(new URL("https://www.youtube.com/watch?v=x"))).toBe(true);
    expect(isAllowedFetchUrl(new URL("http://www.youtube.com/watch?v=x"))).toBe(false);
    expect(isAllowedFetchUrl(new URL("https://169.254.169.254/latest"))).toBe(false);
    expect(isAllowedFetchUrl(new URL("https://[::1]/"))).toBe(false);
    expect(isAllowedFetchUrl(new URL("https://youtube.com.evil.example/"))).toBe(false);
  });

  it("does not follow a redirect off the allowlist", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest/meta-data" } }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await fetchAllowlisted("https://www.youtube.com/watch?v=x", { timeoutMs: 1000 })).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("follows an allowlisted redirect and caps the body", async () => {
    const big = "a".repeat(MAX_SCRAPE_BODY_BYTES * 2);
    const fetchMock = vi.fn(async (input: any) =>
      String(input).includes("youtu.be")
        ? new Response(null, { status: 301, headers: { location: "https://www.youtube.com/watch?v=x" } })
        : new Response(big, { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const res = await fetchAllowlisted("https://youtu.be/x", { timeoutMs: 1000 });
    expect(res?.status).toBe(200);
    expect(res!.body.length).toBeLessThanOrEqual(MAX_SCRAPE_BODY_BYTES);
  });
});

describe("visitor geo cache", () => {
  it("stays bounded no matter how many distinct addresses ping", async () => {
    for (let i = 0; i < GEO_CACHE_MAX_ENTRIES + 50; i++) {
      await cachedCountryForIp(`203.${(i >> 16) & 255}.${(i >> 8) & 255}.${i & 255}`);
    }
    expect(geoCacheSizeForTests()).toBeLessThanOrEqual(GEO_CACHE_MAX_ENTRIES);
  });
});
