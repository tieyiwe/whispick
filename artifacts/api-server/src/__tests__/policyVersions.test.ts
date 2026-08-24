import { describe, it, expect, afterEach } from "vitest";
import request from "supertest";
import app from "../app";
import { TEST_USER_HEADER } from "./setup";
import { adminHeaders } from "./adminTestUtils";

const ADMIN_CLERK_ID = "clerk_policy_admin";
const ADMIN_EMAIL = `${ADMIN_CLERK_ID}@blindwhisper.com`;
const MEMBER = "clerk_policy_member";

function asUser(userId: string) {
  return { [TEST_USER_HEADER]: userId };
}

async function asAdmin() {
  return adminHeaders(ADMIN_CLERK_ID, ADMIN_EMAIL);
}

afterEach(() => {
  delete process.env.ADMIN_EMAILS;
});

describe("Policy re-consent system", () => {
  it("draft → publish → user sees it pending → agree → pending clears", async () => {
    const admin = await asAdmin();

    const draft = await request(app)
      .post("/api/admin/policy-versions")
      .set(admin)
      .send({ docType: "privacy", summary: "We clarified how phone numbers are used for delivery routing." });
    expect(draft.status).toBe(201);
    expect(draft.body.publishedAt).toBeNull();

    // Draft is invisible to users.
    const before = await request(app).get("/api/user/policy-status").set(asUser(MEMBER));
    expect(before.body.pending).toHaveLength(0);

    const published = await request(app).post(`/api/admin/policy-versions/${draft.body.id}/publish`).set(admin);
    expect(published.status).toBe(200);
    expect(published.body.publishedAt).not.toBeNull();

    const pending = await request(app).get("/api/user/policy-status").set(asUser(MEMBER));
    expect(pending.body.pending).toHaveLength(1);
    expect(pending.body.pending[0].docType).toBe("privacy");
    expect(pending.body.pending[0].summary).toContain("phone numbers");

    const agree = await request(app)
      .post("/api/user/policy-acceptances")
      .set(asUser(MEMBER))
      .send({ policyVersionIds: [draft.body.id] });
    expect(agree.status).toBe(204);

    const after = await request(app).get("/api/user/policy-status").set(asUser(MEMBER));
    expect(after.body.pending).toHaveLength(0);

    // Idempotent re-accept.
    const again = await request(app)
      .post("/api/user/policy-acceptances")
      .set(asUser(MEMBER))
      .send({ policyVersionIds: [draft.body.id] });
    expect(again.status).toBe(204);

    // Admin list shows the acceptance count.
    const list = await request(app).get("/api/admin/policy-versions").set(admin);
    const row = list.body.items.find((v: any) => v.id === draft.body.id);
    expect(row.acceptedCount).toBe(1);
  });

  it("only the LATEST published version per doc type requires consent", async () => {
    const admin = await asAdmin();
    const v1 = await request(app).post("/api/admin/policy-versions").set(admin).send({ docType: "terms", summary: "First update." });
    await request(app).post(`/api/admin/policy-versions/${v1.body.id}/publish`).set(admin);
    const v2 = await request(app).post("/api/admin/policy-versions").set(admin).send({ docType: "terms", summary: "Second update." });
    await request(app).post(`/api/admin/policy-versions/${v2.body.id}/publish`).set(admin);

    const pending = await request(app).get("/api/user/policy-status").set(asUser(MEMBER));
    expect(pending.body.pending).toHaveLength(1);
    expect(pending.body.pending[0].id).toBe(v2.body.id);
  });

  it("tracks privacy and terms independently", async () => {
    const admin = await asAdmin();
    const privacy = await request(app).post("/api/admin/policy-versions").set(admin).send({ docType: "privacy", summary: "Privacy change." });
    await request(app).post(`/api/admin/policy-versions/${privacy.body.id}/publish`).set(admin);
    const terms = await request(app).post("/api/admin/policy-versions").set(admin).send({ docType: "terms", summary: "Terms change." });
    await request(app).post(`/api/admin/policy-versions/${terms.body.id}/publish`).set(admin);

    const pending = await request(app).get("/api/user/policy-status").set(asUser(MEMBER));
    expect(pending.body.pending).toHaveLength(2);

    await request(app).post("/api/user/policy-acceptances").set(asUser(MEMBER)).send({ policyVersionIds: [privacy.body.id] });
    const after = await request(app).get("/api/user/policy-status").set(asUser(MEMBER));
    expect(after.body.pending).toHaveLength(1);
    expect(after.body.pending[0].docType).toBe("terms");
  });

  it("accepting a draft id records nothing", async () => {
    const admin = await asAdmin();
    const draft = await request(app).post("/api/admin/policy-versions").set(admin).send({ docType: "privacy", summary: "Unpublished." });

    const agree = await request(app)
      .post("/api/user/policy-acceptances")
      .set(asUser(MEMBER))
      .send({ policyVersionIds: [draft.body.id] });
    expect(agree.status).toBe(204);

    await request(app).post(`/api/admin/policy-versions/${draft.body.id}/publish`).set(admin);
    // The pre-publish "acceptance" must not count — nothing had been shown.
    const pending = await request(app).get("/api/user/policy-status").set(asUser(MEMBER));
    expect(pending.body.pending).toHaveLength(1);
  });

  it("published versions are immutable and undeletable; drafts are editable and deletable", async () => {
    const admin = await asAdmin();
    const draft = await request(app).post("/api/admin/policy-versions").set(admin).send({ docType: "terms", summary: "Typo'd sumary." });

    const edit = await request(app).patch(`/api/admin/policy-versions/${draft.body.id}`).set(admin).send({ summary: "Fixed summary." });
    expect(edit.status).toBe(200);
    expect(edit.body.summary).toBe("Fixed summary.");

    await request(app).post(`/api/admin/policy-versions/${draft.body.id}/publish`).set(admin);
    const editPublished = await request(app).patch(`/api/admin/policy-versions/${draft.body.id}`).set(admin).send({ summary: "Sneaky rewrite." });
    expect(editPublished.status).toBe(409);
    const deletePublished = await request(app).delete(`/api/admin/policy-versions/${draft.body.id}`).set(admin);
    expect(deletePublished.status).toBe(409);
    const republish = await request(app).post(`/api/admin/policy-versions/${draft.body.id}/publish`).set(admin);
    expect(republish.status).toBe(409);

    const discardable = await request(app).post("/api/admin/policy-versions").set(admin).send({ docType: "terms", summary: "Never mind." });
    const discard = await request(app).delete(`/api/admin/policy-versions/${discardable.body.id}`).set(admin);
    expect(discard.status).toBe(204);
  });

  it("policy endpoints require auth / admin respectively", async () => {
    const status = await request(app).get("/api/user/policy-status");
    expect(status.status).toBe(401);
    const create = await request(app).post("/api/admin/policy-versions").set(asUser(MEMBER)).send({ docType: "privacy", summary: "Nope." });
    expect(create.status).toBe(403);
  });
});
