import { describe, expect, it } from "vitest";
import { GESTURE_VOCABULARY, getGestureText, getLocalizedGestureText, mapToRecognizedGestureText } from "./gestureVocabulary";
import type { GestureLabel } from "./gestureTypes";

const ALL_GESTURES: GestureLabel[] = ["OPEN_PALM", "FIST", "THUMBS_UP", "PEACE", "POINT", "UNKNOWN"];

describe("gestureVocabulary: existing (unlocalized) behavior is unchanged", () => {
  it("getGestureText still returns the English mapping directly", () => {
    expect(getGestureText("OPEN_PALM")).toBe("Hello");
    expect(getGestureText("UNKNOWN")).toBeNull();
  });

  it("mapToRecognizedGestureText still always uses English text (the pipeline's payload is not localized)", () => {
    const result = mapToRecognizedGestureText({ gesture: "FIST", confidence: 0.9, timestamp: 123 });
    expect(result.text).toBe("Stop");
    expect(result.gesture).toBe("FIST");
    expect(result.confidence).toBe(0.9);
    expect(result.timestamp).toBe(123);
  });
});

describe("gestureVocabulary: getLocalizedGestureText (Phase 10)", () => {
  it("en-IN matches GESTURE_VOCABULARY exactly", () => {
    for (const gesture of ALL_GESTURES) {
      expect(getLocalizedGestureText(gesture, "en-IN")).toBe(GESTURE_VOCABULARY[gesture]);
    }
  });

  it("every gesture has a translation (or null for UNKNOWN) in every supported language", () => {
    for (const language of ["en-IN", "hi-IN", "te-IN"] as const) {
      for (const gesture of ALL_GESTURES) {
        const text = getLocalizedGestureText(gesture, language);
        if (gesture === "UNKNOWN") {
          expect(text).toBeNull();
        } else {
          expect(typeof text).toBe("string");
          expect((text as string).length).toBeGreaterThan(0);
        }
      }
    }
  });

  it("Hindi and Telugu text differs from English for real (non-UNKNOWN) gestures", () => {
    expect(getLocalizedGestureText("OPEN_PALM", "hi-IN")).not.toBe(getLocalizedGestureText("OPEN_PALM", "en-IN"));
    expect(getLocalizedGestureText("OPEN_PALM", "te-IN")).not.toBe(getLocalizedGestureText("OPEN_PALM", "en-IN"));
  });

  it("falls back to English for an unrecognized language code rather than throwing", () => {
    expect(getLocalizedGestureText("OPEN_PALM", "fr-FR" as never)).toBe("Hello");
  });
});
