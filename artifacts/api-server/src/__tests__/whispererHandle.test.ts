import { describe, it, expect } from "vitest";
import { isWhisperBoxHandlePersonalized } from "../lib/whispererHandle";

describe("isWhisperBoxHandlePersonalized", () => {
  it("is false with no handle or no display name", () => {
    expect(isWhisperBoxHandlePersonalized(null, "Jane Doe")).toBe(false);
    expect(isWhisperBoxHandlePersonalized("JaneDoe", null)).toBe(false);
    expect(isWhisperBoxHandlePersonalized(null, null)).toBe(false);
  });

  it("is true for the bare slug of the current display name", () => {
    expect(isWhisperBoxHandlePersonalized("JaneDoe", "Jane Doe")).toBe(true);
  });

  it("is true for the slug plus a 3-digit collision suffix", () => {
    expect(isWhisperBoxHandlePersonalized("JaneDoe482", "Jane Doe")).toBe(true);
  });

  it("is false for a leftover handle that predates the current name", () => {
    expect(isWhisperBoxHandlePersonalized("SwiftFalcon482", "Jane Doe")).toBe(false);
  });

  it("is false once the display name has changed since the handle was generated", () => {
    expect(isWhisperBoxHandlePersonalized("JaneDoe", "Janet Doerite")).toBe(false);
  });

  it("is false for a too-short suffix that isn't exactly 3 digits", () => {
    expect(isWhisperBoxHandlePersonalized("JaneDoe42", "Jane Doe")).toBe(false);
    expect(isWhisperBoxHandlePersonalized("JaneDoe4821", "Jane Doe")).toBe(false);
  });
});
