import { describe, it, expect } from "vitest";
import { randomUUID } from "crypto";
import { db, suggestedVideosTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { anthropicMessagesCreateMock } from "./setup";
import { generateSuggestionSummaryAsync } from "../lib/suggestionSummary";

async function insertSuggestion(overrides: Partial<typeof suggestedVideosTable.$inferInsert> = {}) {
  const id = randomUUID();
  await db.insert(suggestedVideosTable).values({
    id,
    videoUrl: `https://youtu.be/${id.slice(0, 11)}`,
    videoTitle: "A video about resilience",
    categories: ["motivational"],
    featured: false,
    status: "published",
    source: "admin",
    ...overrides,
  });
  return id;
}

describe("generateSuggestionSummaryAsync", () => {
  it("generates and stores a summary", async () => {
    anthropicMessagesCreateMock.mockResolvedValueOnce({
      content: [{ type: "text", text: "A reminder that setbacks aren't the end of the story." }],
    });
    const id = await insertSuggestion();

    await generateSuggestionSummaryAsync(id);

    const row = await db.select().from(suggestedVideosTable).where(eq(suggestedVideosTable.id, id)).then((r) => r[0]);
    expect(row?.aiSummaryStatus).toBe("ready");
    expect(row?.aiSummary).toContain("setbacks aren't the end");
  });

  it("marks unavailable when the Claude call fails", async () => {
    anthropicMessagesCreateMock.mockRejectedValueOnce(new Error("upstream failure"));
    const id = await insertSuggestion();

    await generateSuggestionSummaryAsync(id);

    const row = await db.select().from(suggestedVideosTable).where(eq(suggestedVideosTable.id, id)).then((r) => r[0]);
    expect(row?.aiSummaryStatus).toBe("unavailable");
    expect(row?.aiSummary).toBeNull();
  });

  it("truncates an overlong summary to 200 characters with an ellipsis", async () => {
    anthropicMessagesCreateMock.mockResolvedValueOnce({
      content: [{ type: "text", text: "y".repeat(250) }],
    });
    const id = await insertSuggestion();

    await generateSuggestionSummaryAsync(id);

    const row = await db.select().from(suggestedVideosTable).where(eq(suggestedVideosTable.id, id)).then((r) => r[0]);
    expect(row?.aiSummary?.length).toBe(200);
    expect(row?.aiSummary?.endsWith("…")).toBe(true);
  });

  it("does not attempt again once a status is already set (atomic claim)", async () => {
    const id = await insertSuggestion({ aiSummaryStatus: "unavailable" });

    await generateSuggestionSummaryAsync(id);

    expect(anthropicMessagesCreateMock).not.toHaveBeenCalled();
  });

  it("does nothing for a suggestion id that doesn't exist", async () => {
    await expect(generateSuggestionSummaryAsync(randomUUID())).resolves.not.toThrow();
    expect(anthropicMessagesCreateMock).not.toHaveBeenCalled();
  });
});
