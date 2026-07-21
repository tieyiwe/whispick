import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import app from "../app";
import { db, uploadedVideosTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { TEST_USER_HEADER } from "./setup";

const objectStorageMock = vi.hoisted(() => ({
  uploadObject: vi.fn(async () => true),
  downloadObject: vi.fn(async () => Buffer.from("fake-video-bytes")),
  deleteObject: vi.fn(async () => undefined),
}));

vi.mock("../lib/objectStorage", () => objectStorageMock);

const USER_A = "clerk_media_sender";
const USER_B = "clerk_media_other";

function asUser(userId: string) {
  return { [TEST_USER_HEADER]: userId };
}

function tinyMp4() {
  return Buffer.from("00000018667479706d703432", "hex");
}

async function uploadVideo(userId = USER_A, overrides: { durationSeconds?: string | null } = {}) {
  const req = request(app)
    .post("/api/media/upload")
    .set(asUser(userId))
    .field("durationSeconds", overrides.durationSeconds === undefined ? "30" : (overrides.durationSeconds ?? ""))
    .attach("video", tinyMp4(), { filename: "clip.mp4", contentType: "video/mp4" });
  return req;
}

beforeEach(() => {
  objectStorageMock.uploadObject.mockClear().mockResolvedValue(true);
  objectStorageMock.downloadObject.mockClear().mockResolvedValue(Buffer.from("fake-video-bytes"));
  objectStorageMock.deleteObject.mockClear().mockResolvedValue(undefined);
});

describe("POST /api/media/upload", () => {
  it("rejects unauthenticated requests", async () => {
    const res = await request(app).post("/api/media/upload").field("durationSeconds", "30").attach("video", tinyMp4(), "clip.mp4");
    expect(res.status).toBe(401);
  });

  it("requires a video file", async () => {
    const res = await request(app).post("/api/media/upload").set(asUser(USER_A)).field("durationSeconds", "30");
    expect(res.status).toBe(400);
  });

  it("rejects an unsupported video format", async () => {
    const res = await request(app)
      .post("/api/media/upload")
      .set(asUser(USER_A))
      .field("durationSeconds", "30")
      .attach("video", tinyMp4(), { filename: "clip.avi", contentType: "video/x-msvideo" });
    expect(res.status).toBe(400);
  });

  it("requires a valid duration", async () => {
    const res = await uploadVideo(USER_A, { durationSeconds: "not-a-number" });
    expect(res.status).toBe(400);
  });

  it("rejects a video longer than the cap", async () => {
    const res = await uploadVideo(USER_A, { durationSeconds: "600" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("video_too_long");
  });

  it("uploads a valid short clip and stores it as ready", async () => {
    const res = await uploadVideo();
    expect(res.status).toBe(201);
    expect(res.body.status).toBe("ready");
    expect(res.body.durationSeconds).toBe(30);
    expect(res.body.usageCount).toBe(0);
    expect(objectStorageMock.uploadObject).toHaveBeenCalledTimes(1);
    expect(new Date(res.body.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it("returns 503 when object storage is unavailable", async () => {
    objectStorageMock.uploadObject.mockResolvedValueOnce(false);
    const res = await uploadVideo();
    expect(res.status).toBe(503);
  });
});

describe("GET /api/media", () => {
  it("only lists the requesting user's own media, with a usage count", async () => {
    const mine = await uploadVideo(USER_A);
    await uploadVideo(USER_B);

    await request(app)
      .post("/api/whisps")
      .set(asUser(USER_A))
      .send({ deliveryMethod: "circle_drop", uploadedVideoId: mine.body.id });

    const res = await request(app).get("/api/media").set(asUser(USER_A));
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].id).toBe(mine.body.id);
    expect(res.body[0].usageCount).toBe(1);
  });
});

describe("DELETE /api/media/:id", () => {
  it("404s for media that isn't yours", async () => {
    const mine = await uploadVideo(USER_A);
    const res = await request(app).delete(`/api/media/${mine.body.id}`).set(asUser(USER_B));
    expect(res.status).toBe(404);
  });

  it("deletes storage bytes and marks the row deleted", async () => {
    const mine = await uploadVideo(USER_A);
    const res = await request(app).delete(`/api/media/${mine.body.id}`).set(asUser(USER_A));
    expect(res.status).toBe(200);
    expect(objectStorageMock.deleteObject).toHaveBeenCalled();

    const row = await db.select().from(uploadedVideosTable).where(eq(uploadedVideosTable.id, mine.body.id)).then((r) => r[0]);
    expect(row?.status).toBe("deleted");
  });

  it("410s a file stream after deletion", async () => {
    const mine = await uploadVideo(USER_A);
    await request(app).delete(`/api/media/${mine.body.id}`).set(asUser(USER_A));

    const res = await request(app).get(`/api/media/${mine.body.id}/file`).set(asUser(USER_A));
    expect(res.status).toBe(410);
  });
});

describe("whisps created from an uploaded video", () => {
  it("rejects an uploadedVideoId that isn't owned by the sender", async () => {
    const theirs = await uploadVideo(USER_B);
    const res = await request(app)
      .post("/api/whisps")
      .set(asUser(USER_A))
      .send({ deliveryMethod: "circle_drop", uploadedVideoId: theirs.body.id });
    expect(res.status).toBe(400);
  });

  it("creates an upload-platform whisp and streams it publicly by token", async () => {
    const media = await uploadVideo(USER_A);
    const res = await request(app)
      .post("/api/whisps")
      .set(asUser(USER_A))
      .send({ deliveryMethod: "circle_drop", uploadedVideoId: media.body.id });

    expect(res.status).toBe(201);
    expect(res.body.videoPlatform).toBe("upload");
    expect(res.body.uploadedVideoId).toBe(media.body.id);

    const publicView = await request(app).get(`/api/public/w/${res.body.publicToken}`);
    expect(publicView.body.hasUpload).toBe(true);

    const stream = await request(app).get(`/api/public/w/${res.body.publicToken}/media`);
    expect(stream.status).toBe(200);
  });

  it("404s the public media stream once the whisp's video has expired from retention", async () => {
    const media = await uploadVideo(USER_A);
    const res = await request(app)
      .post("/api/whisps")
      .set(asUser(USER_A))
      .send({ deliveryMethod: "circle_drop", uploadedVideoId: media.body.id });

    await db.update(uploadedVideosTable).set({ status: "expired" }).where(eq(uploadedVideosTable.id, media.body.id));

    const stream = await request(app).get(`/api/public/w/${res.body.publicToken}/media`);
    expect(stream.status).toBe(410);
  });
});
