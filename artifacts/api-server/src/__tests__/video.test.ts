import { describe, it, expect } from "vitest";
import request from "supertest";
import app from "../app";

describe("POST /api/video/meta", () => {
  it("rejects URLs outside the video-platform allowlist (no server-side fetch of arbitrary hosts)", async () => {
    const res = await request(app).post("/api/video/meta").send({ url: "http://169.254.169.254/latest/meta-data/" });
    expect(res.status).toBe(400);
  });

  it("rejects a non-allowlisted host even when a known platform name appears in the query string", async () => {
    const res = await request(app).post("/api/video/meta").send({ url: "https://evil.example.com/?u=youtube.com" });
    expect(res.status).toBe(400);
  });

  it("rejects non-http(s) schemes", async () => {
    const res = await request(app).post("/api/video/meta").send({ url: "ftp://youtube.com/x" });
    expect(res.status).toBe(400);
  });
});
