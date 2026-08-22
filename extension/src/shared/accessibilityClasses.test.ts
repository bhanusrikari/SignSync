import { describe, expect, it } from "vitest";
import { motionEnabled, pageAccessibilityClasses } from "./accessibilityClasses";

const OFF = { highContrast: false, largeText: false, reducedMotion: false };

describe("pageAccessibilityClasses (Phase 10.1 Part 9)", () => {
  it("defaults to the normal (small) text size with no contrast override", () => {
    const classes = pageAccessibilityClasses(OFF);
    expect(classes).toContain("text-sm");
    expect(classes).not.toContain("contrast-more");
  });

  it("large text switches to the larger size class", () => {
    expect(pageAccessibilityClasses({ ...OFF, largeText: true })).toContain("text-base");
  });

  it("high contrast adds the contrast utility class", () => {
    expect(pageAccessibilityClasses({ ...OFF, highContrast: true })).toContain("contrast-more");
  });

  it("both settings together apply both classes", () => {
    const classes = pageAccessibilityClasses({ highContrast: true, largeText: true, reducedMotion: false });
    expect(classes).toContain("text-base");
    expect(classes).toContain("contrast-more");
  });
});

describe("motionEnabled", () => {
  it("is true by default (reducedMotion off)", () => {
    expect(motionEnabled(OFF)).toBe(true);
  });

  it("is false when reducedMotion is on", () => {
    expect(motionEnabled({ ...OFF, reducedMotion: true })).toBe(false);
  });
});
