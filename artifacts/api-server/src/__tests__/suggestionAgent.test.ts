import { describe, it, expect, vi, afterEach } from "vitest";
import { randomUUID } from "crypto";
import { db, suggestedVideosTable, suggestionAgentStatusTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { anthropicMessagesCreateMock } from "./setup";
import { runSuggestionDiscoveryAgent } from "../lib/suggestionAgent";

async function getAgentStatus() {
  return db.select().from(suggestionAgentStatusTable).where(eq(suggestionAgentStatusTable.id, "singleton")).then((r) => r[0]);
}

const GOOD_URL = "https://youtu.be/goodVideo12";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function stubYoutubeOembed() {
  const fetchMock = vi.fn(async (input: any) => {
    const url = String(input);
    if (url.includes("youtube.com/oembed")) {
      return jsonResponse(200, { title: "A discovered video", thumbnail_url: "https://img.example/x.jpg", author_name: "Someone" });
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("runSuggestionDiscoveryAgent", () => {
  it("parses URLs (stripping trailing punctuation), validates through the hostname allowlist, dedupes across categories, and inserts survivors as pending ai_agent rows", async () => {
    const fetchMock = stubYoutubeOembed();
    anthropicMessagesCreateMock.mockResolvedValue({
      content: [{ type: "text", text: `Check out ${GOOD_URL}. Also see https://evil.example.com/not-allowlisted,` }],
    });

    const result = await runSuggestionDiscoveryAgent();

    expect(result.inserted).toBe(1);
    expect(result.skipped).toBeGreaterThan(0);

    const row = await db.select().from(suggestedVideosTable).where(eq(suggestedVideosTable.videoUrl, GOOD_URL)).then((r) => r[0]);
    expect(row).toBeDefined();
    expect(row?.source).toBe("ai_agent");
    expect(row?.status).toBe("pending");
    expect(row?.addedByUserId).toBeNull();
    expect(row?.videoTitle).toBe("A discovered video");

    // The evil.example.com URL was never on the hostname allowlist, so it
    // should never have reached fetch() at all (same SSRF guard resolveVideoMeta
    // gives every other entry point).
    expect(fetchMock.mock.calls.every(([input]) => !String(input).includes("evil.example.com"))).toBe(true);
  });

  it("does not insert a URL that's already in the library", async () => {
    await db.insert(suggestedVideosTable).values({
      id: randomUUID(),
      videoUrl: GOOD_URL,
      categories: ["motivational"],
      featured: false,
      status: "published",
      source: "admin",
    });
    stubYoutubeOembed();
    anthropicMessagesCreateMock.mockResolvedValue({
      content: [{ type: "text", text: GOOD_URL }],
    });

    const result = await runSuggestionDiscoveryAgent();

    expect(result.inserted).toBe(0);
    expect(result.skipped).toBeGreaterThan(0);

    const rows = await db.select().from(suggestedVideosTable).where(eq(suggestedVideosTable.videoUrl, GOOD_URL));
    expect(rows.length).toBe(1);
  });

  it("skips a category's candidates entirely if its search call fails, without failing the whole run", async () => {
    stubYoutubeOembed();
    anthropicMessagesCreateMock.mockRejectedValue(new Error("search unavailable"));

    const result = await runSuggestionDiscoveryAgent();

    expect(result.inserted).toBe(0);
    expect(result.skipped).toBe(0);
  });
});

describe("runSuggestionDiscoveryAgent — run status tracking", () => {
  it("flags a run as low-credit when every category's search call fails with a credit-balance-shaped message", async () => {
    anthropicMessagesCreateMock.mockRejectedValue(
      new Error("Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits."),
    );

    await runSuggestionDiscoveryAgent();

    const row = await getAgentStatus();
    expect(row?.lastRunOk).toBe(false);
    expect(row?.lowCreditSuspected).toBe(true);
    expect(row?.lastErrorMessage).toContain("credit balance");
    expect(row?.consecutiveFailures).toBe(1);
  });

  it("records a run as failed (but not low-credit) for an unrelated error, and increments consecutiveFailures across repeated failures", async () => {
    anthropicMessagesCreateMock.mockRejectedValue(new Error("upstream timeout"));

    await runSuggestionDiscoveryAgent();
    let row = await getAgentStatus();
    expect(row?.lastRunOk).toBe(false);
    expect(row?.lowCreditSuspected).toBe(false);
    expect(row?.consecutiveFailures).toBe(1);

    await runSuggestionDiscoveryAgent();
    row = await getAgentStatus();
    expect(row?.consecutiveFailures).toBe(2);
  });

  it("does not flag a run as failed when only some categories fail (a partial result is still a healthy run)", async () => {
    stubYoutubeOembed();
    anthropicMessagesCreateMock
      .mockResolvedValueOnce({ content: [{ type: "text", text: GOOD_URL }] })
      .mockRejectedValueOnce(new Error("search unavailable"))
      .mockRejectedValueOnce(new Error("search unavailable"));

    await runSuggestionDiscoveryAgent();

    const row = await getAgentStatus();
    expect(row?.lastRunOk).toBe(true);
    expect(row?.lowCreditSuspected).toBe(false);
    expect(row?.consecutiveFailures).toBe(0);
  });

  it("resets consecutiveFailures and clears the low-credit flag once a run succeeds again", async () => {
    anthropicMessagesCreateMock.mockRejectedValue(new Error("Your credit balance is too low to access the Anthropic API."));
    await runSuggestionDiscoveryAgent();
    expect((await getAgentStatus())?.lowCreditSuspected).toBe(true);

    stubYoutubeOembed();
    anthropicMessagesCreateMock.mockResolvedValue({ content: [{ type: "text", text: GOOD_URL }] });
    await runSuggestionDiscoveryAgent();

    const row = await getAgentStatus();
    expect(row?.lastRunOk).toBe(true);
    expect(row?.lowCreditSuspected).toBe(false);
    expect(row?.consecutiveFailures).toBe(0);
  });
});
