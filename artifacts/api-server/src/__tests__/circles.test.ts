import { describe, it, expect } from "vitest";
import request from "supertest";
import app from "../app";
import { TEST_USER_HEADER } from "./setup";

const USER_A = "clerk_user_a";
const USER_B = "clerk_user_b";

function asUser(userId: string) {
  return { [TEST_USER_HEADER]: userId };
}

describe("POST /api/circles", () => {
  it("rejects unauthenticated requests", async () => {
    const res = await request(app).post("/api/circles").send({ name: "Book Club" });
    expect(res.status).toBe(401);
  });

  it("creates a circle and auto-joins the creator", async () => {
    const created = await request(app).post("/api/circles").set(asUser(USER_A)).send({ name: "Book Club" });
    expect(created.status).toBe(201);
    expect(created.body.name).toBe("Book Club");
    expect(created.body.inviteCode).toBeTruthy();

    const list = await request(app).get("/api/circles").set(asUser(USER_A));
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0].id).toBe(created.body.id);
  });
});

describe("POST /api/circles/join", () => {
  it("rejects an invalid invite code", async () => {
    const res = await request(app).post("/api/circles/join").set(asUser(USER_A)).send({ inviteCode: "does-not-exist" });
    expect(res.status).toBe(404);
  });

  it("lets another user join via invite code", async () => {
    const created = await request(app).post("/api/circles").set(asUser(USER_A)).send({ name: "Family" });

    const joined = await request(app)
      .post("/api/circles/join")
      .set(asUser(USER_B))
      .send({ inviteCode: created.body.inviteCode });
    expect(joined.status).toBe(200);
    expect(joined.body.id).toBe(created.body.id);

    const listB = await request(app).get("/api/circles").set(asUser(USER_B));
    expect(listB.body).toHaveLength(1);
  });

  it("is idempotent when joining a circle you're already in", async () => {
    const created = await request(app).post("/api/circles").set(asUser(USER_A)).send({ name: "Family" });

    await request(app).post("/api/circles/join").set(asUser(USER_A)).send({ inviteCode: created.body.inviteCode });
    const again = await request(app)
      .post("/api/circles/join")
      .set(asUser(USER_A))
      .send({ inviteCode: created.body.inviteCode });
    expect(again.status).toBe(200);

    const list = await request(app).get("/api/circles").set(asUser(USER_A));
    expect(list.body).toHaveLength(1);
  });
});

describe("GET /api/circles/:id/feed", () => {
  it("rejects non-members with 403", async () => {
    const created = await request(app).post("/api/circles").set(asUser(USER_A)).send({ name: "Private" });

    const res = await request(app).get(`/api/circles/${created.body.id}/feed`).set(asUser(USER_B));
    expect(res.status).toBe(403);
  });

  it("only shows whisps dropped into that specific circle to its members, and never in the public feed", async () => {
    const created = await request(app).post("/api/circles").set(asUser(USER_A)).send({ name: "Private" });
    const circleId = created.body.id;

    await request(app)
      .post("/api/whisps")
      .set(asUser(USER_A))
      .send({ videoUrl: "https://youtu.be/private", deliveryMethod: "circle_drop", circleId });
    await request(app)
      .post("/api/whisps")
      .set(asUser(USER_A))
      .send({ videoUrl: "https://youtu.be/public", deliveryMethod: "circle_drop" });

    const feed = await request(app).get(`/api/circles/${circleId}/feed`).set(asUser(USER_A));
    expect(feed.status).toBe(200);
    expect(feed.body.items).toHaveLength(1);
    expect(feed.body.items[0].videoUrl).toBe("https://youtu.be/private");

    const publicFeed = await request(app).get("/api/public/circle");
    expect(publicFeed.body.items).toHaveLength(1);
    expect(publicFeed.body.items[0].videoUrl).toBe("https://youtu.be/public");
  });

  it("rejects dropping into a circle you're not a member of", async () => {
    const created = await request(app).post("/api/circles").set(asUser(USER_A)).send({ name: "Private" });

    const res = await request(app)
      .post("/api/whisps")
      .set(asUser(USER_B))
      .send({ videoUrl: "https://youtu.be/x", deliveryMethod: "circle_drop", circleId: created.body.id });
    expect(res.status).toBe(403);
  });
});
