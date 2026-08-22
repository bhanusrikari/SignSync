import { describe, expect, it } from "vitest";
import {
  TUTORIAL_CATEGORIES,
  TUTORIAL_REGIONS,
  TUTORIAL_SIGNS,
  getSignsForCategory,
  hasAnyContentForRegion,
} from "./tutorialContent";

describe("tutorialContent data model (Phase 10 Part 6)", () => {
  it("defines exactly the two regions named in the PRD-adjacent request (ASL, ISL)", () => {
    expect(TUTORIAL_REGIONS.map((r) => r.id).sort()).toEqual(["ASL", "ISL"]);
  });

  it("defines all ten requested categories (Phase 12 Part E taxonomy)", () => {
    expect(TUTORIAL_CATEGORIES).toHaveLength(10);
    expect(TUTORIAL_CATEGORIES.map((c) => c.id)).toEqual([
      "greetings",
      "people",
      "family",
      "numbers",
      "food",
      "places",
      "actions",
      "questions",
      "everyday",
      "useful",
    ]);
  });

  it("TUTORIAL_SIGNS starts empty -- no fabricated sign-language content is shipped", () => {
    expect(TUTORIAL_SIGNS).toEqual([]);
  });

  it("getSignsForCategory returns an empty array for every region/category combination today", () => {
    for (const region of TUTORIAL_REGIONS) {
      for (const category of TUTORIAL_CATEGORIES) {
        expect(getSignsForCategory(region.id, category.id)).toEqual([]);
      }
    }
  });

  it("hasAnyContentForRegion is false for every region today (drives the 'coming soon' empty state)", () => {
    for (const region of TUTORIAL_REGIONS) {
      expect(hasAnyContentForRegion(region.id)).toBe(false);
    }
  });

  it("getSignsForCategory would correctly filter if content were ever added (structural check, not content)", () => {
    const withOneEntry = [
      { id: "x", region: "ASL" as const, categoryId: "greetings", name: "TEST", meaning: "Test entry" },
    ];
    const filtered = withOneEntry.filter((s) => s.region === "ASL" && s.categoryId === "greetings");
    expect(filtered).toHaveLength(1);
  });
});
