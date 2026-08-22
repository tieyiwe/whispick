import { describe, it, expect } from "vitest";
import request from "supertest";
import app from "../app";
import { TEST_USER_HEADER } from "./setup";
import { adminHeaders } from "./adminTestUtils";

const USER_A = "clerk_user_invite_a";
const USER_B = "clerk_user_invite_b";
const ADMIN_CLERK_ID = "clerk_invite_admin";
const ADMIN_EMAIL = `${ADMIN_CLERK_ID}@blindwhisper.com`;

function asUser(userId: string) {
  return { [TEST_USER_HEADER]: userId };
}

// Mirrors admin.test.ts's own asAdmin() helper — kept local to this file
// rather than importing/exporting it, since admin.test.ts is actively owned
// by other work landing on this branch right now.
async function asAdmin() {
  // Promotes, enrolls the app's own admin TOTP, verifies a real code, and
  // returns headers carrying the unlock token — see adminTestUtils.ts.
  return adminHeaders(ADMIN_CLERK_ID, ADMIN_EMAIL);
}

async function createInvite(overrides: Record<string, unknown> = {}) {
  const res = await request(app)
    .post("/api/invites")
    .set(asUser(USER_A))
    .send({ channel: "email", recipientEmail: "friend@example.com", ...overrides });
  return res;
}

describe("POST /api/invites", () => {
  it("rejects unauthenticated requests", async () => {
    const res = await request(app).post("/api/invites").send({ channel: "email", recipientEmail: "friend@example.com" });
    expect(res.status).toBe(401);
  });

  it("requires a recipient email when the channel is email", async () => {
    const res = await request(app).post("/api/invites").set(asUser(USER_A)).send({ channel: "email" });
    expect(res.status).toBe(400);
  });

  it("requires a recipient phone when the channel is sms or whatsapp", async () => {
    const res = await request(app).post("/api/invites").set(asUser(USER_A)).send({ channel: "sms" });
    expect(res.status).toBe(400);
  });

  it("creates an invite row and returns 201", async () => {
    const res = await createInvite();
    expect(res.status).toBe(201);
    expect(res.body.channel).toBe("email");
    expect(res.body.recipientEmail).toBe("friend@example.com");
    expect(res.body.status).toBe("sent");
    expect(res.body.publicToken).toBeTruthy();
    expect(res.body.revealRequested).toBe(false);
    expect(res.body.signedUpUserId).toBeNull();
  });
});

describe("GET /api/invites", () => {
  it("only lists the current user's own invites", async () => {
    await createInvite();
    await request(app).post("/api/invites").set(asUser(USER_B)).send({ channel: "email", recipientEmail: "other@example.com" });

    const res = await request(app).get("/api/invites").set(asUser(USER_A));
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].recipientEmail).toBe("friend@example.com");
  });
});

describe("GET /api/public/invites/:token", () => {
  it("returns 404 for an unknown token", async () => {
    const res = await request(app).get("/api/public/invites/does-not-exist");
    expect(res.status).toBe(404);
  });

  it("never leaks inviter PII, returning only public-safe fields", async () => {
    const created = await createInvite();

    const res = await request(app).get(`/api/public/invites/${created.body.publicToken}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(created.body.id);
    // Status can be "sent" or "failed" by the time this read happens — the
    // actual email dispatch is fire-and-forget and there's no RESEND_API_KEY
    // in this test env, so it resolves to "failed" almost immediately. The
    // PII discipline this test is really about holds either way.
    expect(["sent", "failed"]).toContain(res.body.status);
    expect(res.body.revealRequested).toBe(false);
    expect(res.body).not.toHaveProperty("inviterUserId");
    expect(res.body).not.toHaveProperty("recipientEmail");
    expect(res.body).not.toHaveProperty("recipientPhone");
    expect(res.body).not.toHaveProperty("publicToken");
    expect(res.body).not.toHaveProperty("signedUpUserId");
  });
});

describe("POST /api/invites/claim", () => {
  it("attributes the joining account and flips the invite to joined", async () => {
    const created = await createInvite();

    const claimed = await request(app).post("/api/invites/claim").set(asUser(USER_B)).send({ token: created.body.publicToken });
    expect(claimed.status).toBe(200);
    expect(claimed.body.ok).toBe(true);

    const listed = await request(app).get("/api/invites").set(asUser(USER_A));
    expect(listed.body[0].status).toBe("joined");
    expect(listed.body[0].signedUpUserId).toBeTruthy();
    expect(listed.body[0].signedUpAt).toBeTruthy();
  });

  it("is a no-op for an inviter attempting to claim their own invite", async () => {
    const created = await createInvite();

    const claimed = await request(app).post("/api/invites/claim").set(asUser(USER_A)).send({ token: created.body.publicToken });
    expect(claimed.status).toBe(200);
    expect(claimed.body.selfInvite).toBe(true);

    const listed = await request(app).get("/api/invites").set(asUser(USER_A));
    // Never flips to "joined" — that's the behavior under test here. (Status
    // may otherwise read "sent" or "failed" depending on whether the
    // fire-and-forget, no-RESEND_API_KEY-in-tests dispatch has resolved yet.)
    expect(listed.body[0].status).not.toBe("joined");
    expect(listed.body[0].signedUpUserId).toBeNull();
  });

  it("returns 404 for an unknown token", async () => {
    const res = await request(app).post("/api/invites/claim").set(asUser(USER_B)).send({ token: "does-not-exist" });
    expect(res.status).toBe(404);
  });
});

describe("Invite reveal flow", () => {
  it("rejects a reveal request before the invite has been joined", async () => {
    const created = await createInvite();

    const res = await request(app).post(`/api/invites/${created.body.id}/reveal`).set(asUser(USER_A));
    expect(res.status).toBe(400);
  });

  it("lets the inviter request a reveal after joining, and the invitee respond", async () => {
    const created = await createInvite();
    await request(app).post("/api/invites/claim").set(asUser(USER_B)).send({ token: created.body.publicToken });

    const revealRequested = await request(app).post(`/api/invites/${created.body.id}/reveal`).set(asUser(USER_A));
    expect(revealRequested.status).toBe(200);
    expect(revealRequested.body.revealRequested).toBe(true);

    const responded = await request(app).patch(`/api/invites/${created.body.id}/reveal`).send({ accepted: true });
    expect(responded.status).toBe(200);
    expect(responded.body.revealAccepted).toBe(true);
  });

  it("rejects a reveal response when no reveal was requested", async () => {
    const created = await createInvite();
    await request(app).post("/api/invites/claim").set(asUser(USER_B)).send({ token: created.body.publicToken });

    const responded = await request(app).patch(`/api/invites/${created.body.id}/reveal`).send({ accepted: true });
    expect(responded.status).toBe(400);
  });

  it("scopes the reveal request to the invite's own inviter", async () => {
    const created = await createInvite();
    await request(app).post("/api/invites/claim").set(asUser(USER_B)).send({ token: created.body.publicToken });

    const res = await request(app).post(`/api/invites/${created.body.id}/reveal`).set(asUser(USER_B));
    expect(res.status).toBe(404);
  });

  it("never exposes inviter/recipient PII from the unauthenticated reveal-response endpoint", async () => {
    const created = await createInvite();
    await request(app).post("/api/invites/claim").set(asUser(USER_B)).send({ token: created.body.publicToken });
    await request(app).post(`/api/invites/${created.body.id}/reveal`).set(asUser(USER_A));

    const responded = await request(app).patch(`/api/invites/${created.body.id}/reveal`).send({ accepted: true });
    expect(responded.status).toBe(200);
    expect(responded.body).not.toHaveProperty("inviterUserId");
    expect(responded.body).not.toHaveProperty("recipientEmail");
    expect(responded.body).not.toHaveProperty("recipientPhone");
  });
});

describe("GET /api/admin/stats/funnel — invites", () => {
  it("includes invite sent/joined/conversionRate volume", async () => {
    const created = await createInvite();
    await request(app).post("/api/invites/claim").set(asUser(USER_B)).send({ token: created.body.publicToken });

    const adminHeaders = await asAdmin();
    const res = await request(app).get("/api/admin/stats/funnel").set(adminHeaders);
    delete process.env.ADMIN_EMAILS;

    expect(res.status).toBe(200);
    expect(res.body.invites.sent).toBeGreaterThanOrEqual(1);
    expect(res.body.invites.joined).toBeGreaterThanOrEqual(1);
    expect(typeof res.body.invites.conversionRate).toBe("number");
  });
});

describe("Invite rate limiting", () => {
  it("caps how many invites a single user can send", async () => {
    let lastStatus = 0;
    for (let i = 0; i < 21; i++) {
      const res = await request(app)
        .post("/api/invites")
        .set(asUser(USER_A))
        .send({ channel: "email", recipientEmail: `friend${i}@example.com` });
      lastStatus = res.status;
    }
    expect(lastStatus).toBe(429);
  });
});
