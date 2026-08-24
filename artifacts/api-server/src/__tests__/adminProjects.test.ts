import { describe, it, expect, afterEach } from "vitest";
import request from "supertest";
import app from "../app";
import { TEST_USER_HEADER, clerkGetUserMock } from "./setup";
import { adminHeaders, collaboratorHeaders } from "./adminTestUtils";
import { db, notificationsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";

const OWNER_CLERK_ID = "clerk_hq_owner";
const OWNER_EMAIL = `${OWNER_CLERK_ID}@blindwhisper.com`;

function asUser(userId: string) {
  return { [TEST_USER_HEADER]: userId };
}

async function asOwner() {
  return adminHeaders(OWNER_CLERK_ID, OWNER_EMAIL);
}

afterEach(() => {
  delete process.env.ADMIN_EMAILS;
});

describe("HQ projects & tasks", () => {
  it("full flow: project → task → assign (notifies) → progress → done → comment (notifies)", async () => {
    const owner = await asOwner();

    const project = await request(app)
      .post("/api/admin/projects")
      .set(owner)
      .send({ name: "Launch marketing", description: "Everything for the public launch." });
    expect(project.status).toBe(201);

    // A collaborator to assign things to.
    const collabEmail = `hq_collab_${randomUUID()}@example.com`;
    const collabClerkId = `clerk_hq_collab_${randomUUID()}`;
    clerkGetUserMock.mockImplementation(async (id: string) =>
      id === collabClerkId
        ? ({ twoFactorEnabled: true, emailAddresses: [{ id: "e1", emailAddress: collabEmail }], primaryEmailAddressId: "e1", phoneNumbers: [] } as any)
        : ({ twoFactorEnabled: true } as any),
    );
    const collabProfile = await request(app).get("/api/user/profile").set(asUser(collabClerkId));
    await request(app)
      .post("/api/admin/access/grants")
      .set(owner)
      .send({ email: collabEmail, roleTitle: "Assistant", permissions: ["projects"] });

    // Staff list includes both.
    const list = await request(app).get("/api/admin/projects").set(owner);
    expect(list.body.staff.some((s: any) => s.email === collabEmail)).toBe(true);

    const task = await request(app)
      .post(`/api/admin/projects/${project.body.id}/tasks`)
      .set(owner)
      .send({ title: "Draft the press kit", assigneeAdminId: collabProfile.body.id });
    expect(task.status).toBe(201);

    // Assignment notified the collaborator.
    const assignNotifs = await db.select().from(notificationsTable).where(eq(notificationsTable.targetUserId, collabProfile.body.id));
    expect(assignNotifs.some((n) => n.kind === "hq_task" && n.title.includes("assigned"))).toBe(true);

    // Status advance stamps completion.
    const progress = await request(app).patch(`/api/admin/tasks/${task.body.id}`).set(owner).send({ status: "in_progress" });
    expect(progress.body.completedAt).toBeNull();
    const done = await request(app).patch(`/api/admin/tasks/${task.body.id}`).set(owner).send({ status: "done" });
    expect(done.body.completedAt).not.toBeNull();

    // Comment from the owner notifies the assignee.
    const comment = await request(app)
      .post(`/api/admin/tasks/${task.body.id}/comments`)
      .set(owner)
      .send({ body: "Left a first pass in the shared doc." });
    expect(comment.status).toBe(201);
    const comments = await request(app).get(`/api/admin/tasks/${task.body.id}/comments`).set(owner);
    expect(comments.body.items).toHaveLength(1);
    expect(comments.body.items[0].authorEmail).toContain(OWNER_CLERK_ID);
    const commentNotifs = await db.select().from(notificationsTable).where(eq(notificationsTable.targetUserId, collabProfile.body.id));
    expect(commentNotifs.some((n) => n.kind === "hq_task" && n.title.includes("comment"))).toBe(true);

    // Detail view aggregates.
    const detail = await request(app).get(`/api/admin/projects/${project.body.id}`).set(owner);
    expect(detail.body.tasks).toHaveLength(1);
    expect(detail.body.tasks[0].commentCount).toBe(1);
    expect(detail.body.tasks[0].assigneeEmail).toBe(collabEmail);

    // The collaborator (projects-only) can use the workspace but not Users.
    const collab = await collaboratorHeaders(collabClerkId);
    expect((await request(app).get("/api/admin/projects").set(collab)).status).toBe(200);
    expect((await request(app).get("/api/admin/users").set(collab)).status).toBe(403);
  });

  it("archives projects and deletes tasks with their comments", async () => {
    const owner = await asOwner();
    const project = await request(app).post("/api/admin/projects").set(owner).send({ name: "Cleanup" });
    const task = await request(app).post(`/api/admin/projects/${project.body.id}/tasks`).set(owner).send({ title: "Temporary task" });
    await request(app).post(`/api/admin/tasks/${task.body.id}/comments`).set(owner).send({ body: "Note" });

    const archived = await request(app).patch(`/api/admin/projects/${project.body.id}`).set(owner).send({ status: "archived" });
    expect(archived.body.status).toBe("archived");

    const del = await request(app).delete(`/api/admin/tasks/${task.body.id}`).set(owner);
    expect(del.status).toBe(204);
    const comments = await request(app).get(`/api/admin/tasks/${task.body.id}/comments`).set(owner);
    expect(comments.status).toBe(404);
  });
});
