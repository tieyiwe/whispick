import { describe, it, expect } from "vitest";
import request from "supertest";
import app from "../app";
import { TEST_USER_HEADER } from "./setup";

const USER_A = "clerk_appreciation_sender";

async function createWhisp(overrides: Record<string, unknown> = {}) {
  const res = await request(app)
    .post("/api/whisps")
    .set(TEST_USER_HEADER, USER_A)
    .send({ videoUrl: "https://youtu.be/x", deliveryMethod: "circle_drop", ...overrides });
  return res.body as { id: string; publicToken: string };
}

describe("POST /api/public/w/:token/appreciation", () => {
  it("returns 404 for an unknown token", async () => {
    const res = await request(app).post("/api/public/w/does-not-exist/appreciation").send({ appreciated: true });
    expect(res.status).toBe(404);
  });

  it("rejects a non-boolean payload", async () => {
    const whisp = await createWhisp();
    const res = await request(app).post(`/api/public/w/${whisp.publicToken}/appreciation`).send({ appreciated: "yes" });
    expect(res.status).toBe(400);
  });

  it("records a 'yes' response and reflects it on the public and sender views", async () => {
    const whisp = await createWhisp();

    const res = await request(app).post(`/api/public/w/${whisp.publicToken}/appreciation`).send({ appreciated: true });
    expect(res.status).toBe(200);
    expect(res.body.appreciationResponse).toBe("yes");

    const publicView = await request(app).get(`/api/public/w/${whisp.publicToken}`);
    expect(publicView.body.appreciationResponse).toBe("yes");

    const senderView = await request(app).get(`/api/whisps/${whisp.id}`).set(TEST_USER_HEADER, USER_A);
    expect(senderView.body.whisp.appreciationResponse).toBe("yes");
    expect(senderView.body.whisp.appreciationRespondedAt).not.toBeNull();
  });

  it("records a 'no' response", async () => {
    const whisp = await createWhisp();
    const res = await request(app).post(`/api/public/w/${whisp.publicToken}/appreciation`).send({ appreciated: false });
    expect(res.status).toBe(200);
    expect(res.body.appreciationResponse).toBe("no");

    const publicView = await request(app).get(`/api/public/w/${whisp.publicToken}`);
    expect(publicView.body.appreciationResponse).toBe("no");
  });

  it("allows changing the answer afterwards", async () => {
    const whisp = await createWhisp();
    await request(app).post(`/api/public/w/${whisp.publicToken}/appreciation`).send({ appreciated: false });
    const changed = await request(app).post(`/api/public/w/${whisp.publicToken}/appreciation`).send({ appreciated: true });
    expect(changed.status).toBe(200);
    expect(changed.body.appreciationResponse).toBe("yes");
  });
});
