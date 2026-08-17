import { describe, it, expect } from "vitest";
import { categorizeVideo, VIDEO_CATEGORIES } from "../lib/categorize";

describe("categorizeVideo", () => {
  it("exposes more than 3 categories in the taxonomy", () => {
    expect(VIDEO_CATEGORIES.length).toBeGreaterThan(3);
  });

  it("returns uncategorized when nothing matches", () => {
    const result = categorizeVideo("asdkjqwlekj random string", null);
    expect(result).toEqual([{ category: "uncategorized", score: 0 }]);
  });

  it("matches a single clear category from the title", () => {
    const result = categorizeVideo("Best workout routine for beginners at the gym", null);
    expect(result[0]!.category).toBe("fitness-health");
  });

  it("returns at most 3 ranked categories, best fit first", () => {
    const title = "Motivational morning workout recipe for a healthy breakfast";
    const result = categorizeVideo(title, null);
    expect(result.length).toBeLessThanOrEqual(3);
    for (let i = 1; i < result.length; i++) {
      expect(result[i]!.score).toBeLessThanOrEqual(result[i - 1]!.score);
    }
  });

  it("weighs title matches above transcript-only matches", () => {
    const titleOnly = categorizeVideo("Amazing recipe for dinner", null);
    const transcriptBoost = categorizeVideo("Amazing recipe for dinner", "cooking food kitchen chef");
    expect(transcriptBoost[0]!.score).toBeGreaterThan(titleOnly[0]!.score);
    expect(transcriptBoost[0]!.category).toBe("food-cooking");
  });

  it("lets a transcript-only match surface a category the title didn't suggest", () => {
    const result = categorizeVideo("A video", "prayer bible faith blessing church");
    expect(result[0]!.category).toBe("spiritual-faith");
  });
});
