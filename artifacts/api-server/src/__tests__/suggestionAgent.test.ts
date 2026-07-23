import { describe, it, expect, vi, afterEach } from "vitest";
import { randomUUID } from "crypto";
import { db, suggestedVideosTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { anthropicMessagesCreateMock } from "./setup";
import { runSuggestionDiscoveryAgent } from "../lib/suggestionAgent";

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
