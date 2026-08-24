import { describe, it, expect } from "vitest";
import { randomUUID } from "crypto";
import request from "supertest";
import app from "../app";
import { TEST_USER_HEADER } from "./setup";

function asUser(clerkId: string) {
  return { [TEST_USER_HEADER]: clerkId };
}

async function enableWhisperBox(clerkId: string) {
  await request(app).get("/api/user/profile").set(asUser(clerkId));
  const res = await request(app).post("/api/whisper-box/enable").set(asUser(clerkId));
  return res.body.handle as string;
}

describe("GET /api/wb/:handle", () => {
  it("redirects real browsers straight to the app", async () => {
    const clerkId = `clerk_wblink_${randomUUID()}`;
    const handle = await enableWhisperBox(clerkId);

    const res = await request(app)
      .get(`/api/wb/${handle}`)
      .set("User-Agent", "Mozilla/5.0 (iPhone; CPU iPhone OS) AppleWebKit/605.1.15");

    expect(res.status).toBe(302);
    expect(res.headers.location).toContain(`/whisper-box/${handle}`);
  });

  it("serves a real Open Graph card to link-preview crawlers", async () => {
    const clerkId = `clerk_wblink_og_${randomUUID()}`;
    const handle = await enableWhisperBox(clerkId);

    const res = await request(app).get(`/api/wb/${handle}`).set("User-Agent", "WhatsApp/2.23.20 A");

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.text).toContain(handle);
    expect(res.text).toContain("You can tell me anything I need to hear or see");
    expect(res.text).toContain(`/whisper-box/${handle}`);
    expect(res.text).toContain('property="og:site_name" content="Blind Whisper"');
  });

  it("redirects (never unfurls) an unknown handle or a disabled box, even to a crawler", async () => {
    const unknown = await request(app).get(`/api/wb/${randomUUID()}`).set("User-Agent", "WhatsApp/2.23.20 A");
    expect(unknown.status).toBe(302);

    const clerkId = `clerk_wblink_off_${randomUUID()}`;
    const handle = await enableWhisperBox(clerkId);
    await request(app).post("/api/whisper-box/disable").set(asUser(clerkId));

    const disabled = await request(app).get(`/api/wb/${handle}`).set("User-Agent", "WhatsApp/2.23.20 A");
    expect(disabled.status).toBe(302); // an anti-enumeration oracle otherwise — a crawler could tell disabled from unknown
  });
});
