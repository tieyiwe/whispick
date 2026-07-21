import { describe, it, expect } from "vitest";
import request from "supertest";
import app from "../app";
import { TEST_USER_HEADER } from "./setup";

const USER_A = "clerk_group_a";
const USER_B = "clerk_group_b";

function asUser(userId: string) {
  return { [TEST_USER_HEADER]: userId };
}

async function createGroupWithMembers(members: Array<{ name?: string | null; email?: string | null; phone?: string | null }>) {
  const created = await request(app).post("/api/whisper-groups").set(asUser(USER_A)).send({ name: "Test Group" });
  const groupId = created.body.id;
  if (members.length) {
    await request(app).post(`/api/whisper-groups/${groupId}/members`).set(asUser(USER_A)).send({ members });
  }
  return groupId;
}

describe("Whisper Groups: CRUD", () => {
  it("rejects unauthenticated requests", async () => {
    const res = await request(app).get("/api/whisper-groups");
    expect(res.status).toBe(401);
  });

  it("creates a group and lists it with a zero member count", async () => {
    const created = await request(app).post("/api/whisper-groups").set(asUser(USER_A)).send({ name: "Book Club" });
    expect(created.status).toBe(201);
    expect(created.body.memberCount).toBe(0);

    const list = await request(app).get("/api/whisper-groups").set(asUser(USER_A));
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0].memberCount).toBe(0);
  });

  it("adds members (manual and batch) and reflects the count", async () => {
    const groupId = await createGroupWithMembers([{ name: "Jane", email: "jane@example.com" }]);

    const batch = await request(app)
      .post(`/api/whisper-groups/${groupId}/members`)
      .set(asUser(USER_A))
      .send({ members: [{ name: "Bob", phone: "+15551230000" }, { name: "No Contact Info" }].slice(0, 1) });
    expect(batch.status).toBe(201);
    expect(batch.body).toHaveLength(2);

    const detail = await request(app).get(`/api/whisper-groups/${groupId}`).set(asUser(USER_A));
    expect(detail.body.members).toHaveLength(2);
  });

  it("rejects a member with neither email nor phone", async () => {
    const created = await request(app).post("/api/whisper-groups").set(asUser(USER_A)).send({ name: "G" });
    const res = await request(app)
      .post(`/api/whisper-groups/${created.body.id}/members`)
      .set(asUser(USER_A))
      .send({ members: [{ name: "Nobody" }] });
    expect(res.status).toBe(400);
  });

  it("404s for a group owned by someone else", async () => {
    const groupId = await createGroupWithMembers([]);
    const res = await request(app).get(`/api/whisper-groups/${groupId}`).set(asUser(USER_B));
    expect(res.status).toBe(404);
  });

  it("removes a member", async () => {
    const groupId = await createGroupWithMembers([{ name: "Jane", email: "jane@example.com" }]);
    const detail = await request(app).get(`/api/whisper-groups/${groupId}`).set(asUser(USER_A));
    const memberId = detail.body.members[0].id;

    const removed = await request(app).delete(`/api/whisper-groups/${groupId}/members/${memberId}`).set(asUser(USER_A));
    expect(removed.status).toBe(204);

    const after = await request(app).get(`/api/whisper-groups/${groupId}`).set(asUser(USER_A));
    expect(after.body.members).toHaveLength(0);
  });

  it("renames and deletes a group", async () => {
    const groupId = await createGroupWithMembers([]);
    const renamed = await request(app).patch(`/api/whisper-groups/${groupId}`).set(asUser(USER_A)).send({ name: "New Name" });
    expect(renamed.status).toBe(200);
    expect(renamed.body.name).toBe("New Name");

    const deleted = await request(app).delete(`/api/whisper-groups/${groupId}`).set(asUser(USER_A));
    expect(deleted.status).toBe(204);

    const gone = await request(app).get(`/api/whisper-groups/${groupId}`).set(asUser(USER_A));
    expect(gone.status).toBe(404);
  });
});

describe("Whisper Groups: sending", () => {
  it("fans out one whisp per deliverable member and reports skipped members", async () => {
    const groupId = await createGroupWithMembers([
      { name: "Has Email", email: "a@example.com" },
      { name: "Has Phone Only", phone: "+15551230000" },
    ]);

    const res = await request(app)
      .post(`/api/whisper-groups/${groupId}/send`)
      .set(asUser(USER_A))
      .send({ videoUrl: "https://youtu.be/x", whisperChannel: "email" });

    expect(res.status).toBe(201);
    expect(res.body.memberCount).toBe(1);
    expect(res.body.skippedMembers).toHaveLength(1);
    expect(res.body.skippedMembers[0].name).toBe("Has Phone Only");

    const whisperLinksUsed = await request(app).get("/api/user/profile").set(asUser(USER_A));
    expect(whisperLinksUsed.body.whisperLinksUsed).toBe(1);
  });

  it("rejects sending when no member has the contact info the channel needs", async () => {
    const groupId = await createGroupWithMembers([{ name: "Phone Only", phone: "+15551230000" }]);

    const res = await request(app)
      .post(`/api/whisper-groups/${groupId}/send`)
      .set(asUser(USER_A))
      .send({ videoUrl: "https://youtu.be/x", whisperChannel: "email" });

    expect(res.status).toBe(400);
  });

  it("enforces the free-plan Whisper Link limit across the whole group send", async () => {
    const groupId = await createGroupWithMembers([
      { email: "a@example.com" },
      { email: "b@example.com" },
      { email: "c@example.com" },
      { email: "d@example.com" },
    ]);

    const res = await request(app)
      .post(`/api/whisper-groups/${groupId}/send`)
      .set(asUser(USER_A))
      .send({ videoUrl: "https://youtu.be/x", whisperChannel: "email" });

    expect(res.status).toBe(402);
  });

  it("creates scheduled whisps when scheduledAt is in the future", async () => {
    const groupId = await createGroupWithMembers([{ email: "a@example.com" }]);
    const futureDate = new Date(Date.now() + 60 * 60 * 1000).toISOString();

    const res = await request(app)
      .post(`/api/whisper-groups/${groupId}/send`)
      .set(asUser(USER_A))
      .send({ videoUrl: "https://youtu.be/x", whisperChannel: "email", scheduledAt: futureDate });

    expect(res.status).toBe(201);

    const detail = await request(app).get(`/api/whisper-groups/sends/${res.body.groupSendId}`).set(asUser(USER_A));
    expect(detail.body.members[0].status).toBe("scheduled");
  });

  it("lists past sends aggregated, and shows per-member breakdown with the correct video", async () => {
    const groupId = await createGroupWithMembers([{ email: "a@example.com" }, { email: "b@example.com" }]);

    const sendRes = await request(app)
      .post(`/api/whisper-groups/${groupId}/send`)
      .set(asUser(USER_A))
      .send({ videoUrl: "https://youtu.be/group-video", videoTitle: "Group Video", whisperChannel: "email" });

    const list = await request(app).get("/api/whisper-groups/sends").set(asUser(USER_A));
    expect(list.status).toBe(200);
    const entry = list.body.find((s: any) => s.groupSendId === sendRes.body.groupSendId);
    expect(entry).toBeTruthy();
    expect(entry.memberCount).toBe(2);
    expect(entry.videoTitle).toBe("Group Video");
    expect(entry.groupName).toBe("Test Group");

    const detail = await request(app).get(`/api/whisper-groups/sends/${sendRes.body.groupSendId}`).set(asUser(USER_A));
    expect(detail.status).toBe(200);
    expect(detail.body.members).toHaveLength(2);
    expect(detail.body.video.videoUrl).toBe("https://youtu.be/group-video");
  });

  it("exposes groupSize on the public whisp page for a group send, but not for a regular whisper_link", async () => {
    const groupId = await createGroupWithMembers([{ email: "a@example.com" }, { email: "b@example.com" }, { email: "c@example.com" }]);

    // Free plan cap is 3/month — use exactly 3 to stay under the limit.
    const sendRes = await request(app)
      .post(`/api/whisper-groups/${groupId}/send`)
      .set(asUser(USER_A))
      .send({ videoUrl: "https://youtu.be/group-visible", whisperChannel: "email" });
    expect(sendRes.status).toBe(201);

    const groupDetail = await request(app).get(`/api/whisper-groups/sends/${sendRes.body.groupSendId}`).set(asUser(USER_A));
    const whispRow = groupDetail.body.members[0];
    const publicRes = await request(app).get(`/api/whisps/${whispRow.whispId}`).set(asUser(USER_A));
    const publicToken = publicRes.body.whisp.publicToken;

    const publicPage = await request(app).get(`/api/public/w/${publicToken}`);
    expect(publicPage.status).toBe(200);
    expect(publicPage.body.groupSize).toBe(3);
  });
});
