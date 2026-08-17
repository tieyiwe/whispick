import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import app from "../app";
import { db, whispsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { TEST_USER_HEADER, anthropicMessagesCreateMock } from "./setup";
import { generateTakeawayAsync } from "../lib/aiTakeaway";

// Platform-aware and deterministic (not mockResolvedValueOnce-based) because
// whisp creation also fires categorizeWhispAsync's own background call to
// fetchTranscript — a one-shot queued value would race between that call
// and this test's own explicit generateTakeawayAsync call.
const fetchTranscriptMock = vi.hoisted(() =>
  vi.fn(async (_url: string, platform: string | null) =>
    platform === "youtube" ? "A transcript about resilience and letting go." : null,
  ),
);
vi.mock("../lib/transcript", () => ({ fetchTranscript: fetchTranscriptMock }));

// Whisp creation also fires lib/moderation's fire-and-forget content-safety
// pass, which shares the same mocked Anthropic client as generateTakeawayAsync
// — left un-isolated, its calls race the queued mockResolvedValueOnce/
// mockRejectedValueOnce responses and call-count assertions below. Mocked out
// entirely here since this file is specifically about takeaway generation.
vi.mock("../lib/moderation", () => ({ moderateWhispAsync: vi.fn() }));

const USER_A = "clerk_takeaway_sender";

function asUser(userId: string) {
  return { [TEST_USER_HEADER]: userId };
}

async function createWhisp(overrides: Record<string, unknown> = {}) {
  const res = await request(app)
    .post("/api/whisps")
    .set(asUser(USER_A))
    .send({ videoUrl: "https://youtu.be/x", videoPlatform: "youtube", deliveryMethod: "circle_drop", ...overrides });
  return res.body as { id: string; publicToken: string };
}

beforeEach(() => {
  fetchTranscriptMock.mockClear();
});

describe("generateTakeawayAsync", () => {
  it("marks the whisp unavailable when no transcript can be found", async () => {
    const whisp = await createWhisp({ videoPlatform: "tiktok" });

    await generateTakeawayAsync(whisp.id);

    const row = await db.select().from(whispsTable).where(eq(whispsTable.id, whisp.id)).then((r) => r[0]);
    expect(row?.aiTakeawayStatus).toBe("unavailable");
    expect(row?.aiTakeaway).toBeNull();
    expect(anthropicMessagesCreateMock).not.toHaveBeenCalled();
  });

  it("generates and stores a takeaway when a transcript is available", async () => {
    anthropicMessagesCreateMock.mockResolvedValueOnce({
      content: [{ type: "text", text: "You've been carrying more than your share — it's okay to set it down." }],
    });
    const whisp = await createWhisp();

    await generateTakeawayAsync(whisp.id);

    const row = await db.select().from(whispsTable).where(eq(whispsTable.id, whisp.id)).then((r) => r[0]);
    expect(row?.aiTakeawayStatus).toBe("ready");
    expect(row?.aiTakeaway).toContain("carrying more than your share");
    expect(row?.aiTakeawayGeneratedAt).not.toBeNull();
  });

  it("marks the whisp unavailable if the Claude call fails", async () => {
    anthropicMessagesCreateMock.mockRejectedValueOnce(new Error("upstream failure"));
    const whisp = await createWhisp();

    await generateTakeawayAsync(whisp.id);

    const row = await db.select().from(whispsTable).where(eq(whispsTable.id, whisp.id)).then((r) => r[0]);
    expect(row?.aiTakeawayStatus).toBe("unavailable");
  });

  it("does not attempt again once a status is already set", async () => {
    const whisp = await createWhisp();
    await db.update(whispsTable).set({ aiTakeawayStatus: "unavailable" }).where(eq(whispsTable.id, whisp.id));

    await generateTakeawayAsync(whisp.id);

    expect(anthropicMessagesCreateMock).not.toHaveBeenCalled();
  });
});

describe("public whisp page exposure", () => {
  it("includes aiTakeaway fields, populated after a watched_complete event", async () => {
    anthropicMessagesCreateMock.mockResolvedValueOnce({
      content: [{ type: "text", text: "Something worth sitting with." }],
    });
    const whisp = await createWhisp();

    const before = await request(app).get(`/api/public/w/${whisp.publicToken}`);
    expect(before.body.aiTakeaway).toBeNull();
    expect(before.body.aiTakeawayStatus).toBeNull();

    await request(app).post(`/api/public/w/${whisp.publicToken}/track`).send({ eventType: "watched_complete" });
    // Fire-and-forget — give the microtask queue a turn to land the DB write.
    await new Promise((resolve) => setTimeout(resolve, 50));

    const after = await request(app).get(`/api/public/w/${whisp.publicToken}`);
    expect(after.body.aiTakeawayStatus).toBe("ready");
    expect(after.body.aiTakeaway).toContain("worth sitting with");
  });
});
