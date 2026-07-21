import { describe, it, expect } from "vitest";
import request from "supertest";
import app from "../app";
import { TEST_USER_HEADER, anthropicMessagesCreateMock } from "./setup";

function asUser(userId: string) {
  return { [TEST_USER_HEADER]: userId };
}

describe("POST /api/whisps/note-suggestions", () => {
  it("rejects unauthenticated requests", async () => {
    const res = await request(app).post("/api/whisps/note-suggestions").send({ videoTitle: "A video", moodTag: "hopeful" });
    expect(res.status).toBe(401);
  });

  it("rejects an overlong videoTitle", async () => {
    const res = await request(app)
      .post("/api/whisps/note-suggestions")
      .set(asUser("clerk_notes_1"))
      .send({ videoTitle: "x".repeat(400) });
    expect(res.status).toBe(400);
  });

  it("parses one suggestion per line, stripping numbering and quotes", async () => {
    anthropicMessagesCreateMock.mockResolvedValueOnce({
      content: [
        {
          type: "text",
          text: '1. "This made me think of you."\n- Thought you needed this today.\nNo particular reason, just this.',
        },
      ],
    });

    const res = await request(app)
      .post("/api/whisps/note-suggestions")
      .set(asUser("clerk_notes_2"))
      .send({ videoTitle: "A calming video", moodTag: "hopeful" });

    expect(res.status).toBe(200);
    expect(res.body.suggestions).toEqual([
      "This made me think of you.",
      "Thought you needed this today.",
      "No particular reason, just this.",
    ]);
  });

  it("caps suggestions at 3 even if the model returns more lines", async () => {
    anthropicMessagesCreateMock.mockResolvedValueOnce({
      content: [{ type: "text", text: "One\nTwo\nThree\nFour" }],
    });

    const res = await request(app)
      .post("/api/whisps/note-suggestions")
      .set(asUser("clerk_notes_3"))
      .send({});

    expect(res.body.suggestions).toEqual(["One", "Two", "Three"]);
  });

  it("filters out any suggestion that exceeds the 200-character note cap", async () => {
    anthropicMessagesCreateMock.mockResolvedValueOnce({
      content: [{ type: "text", text: `Short one\n${"y".repeat(250)}\nAnother short one` }],
    });

    const res = await request(app)
      .post("/api/whisps/note-suggestions")
      .set(asUser("clerk_notes_4"))
      .send({});

    expect(res.body.suggestions).toEqual(["Short one", "Another short one"]);
  });

  it("returns an empty list rather than erroring when the model call fails", async () => {
    anthropicMessagesCreateMock.mockRejectedValueOnce(new Error("upstream failure"));

    const res = await request(app)
      .post("/api/whisps/note-suggestions")
      .set(asUser("clerk_notes_5"))
      .send({ videoTitle: "A video" });

    expect(res.status).toBe(200);
    expect(res.body.suggestions).toEqual([]);
  });
});
