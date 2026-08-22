import { describe, expect, it } from "vitest";
import {
  generatePersonalizedGestureId,
  getLocalizedMeaning,
  isValidPersonalizedGesture,
  resolvePersonalizedGestureMeaning,
  sanitizeStoredPersonalizedGestures,
} from "./personalizedGestures";
import type { PersonalizedGesture } from "@/types";
import type { Point3D } from "@/ai/gestureTypes";

function makeLandmarks(): Point3D[] {
  return Array.from({ length: 21 }, (_, i) => ({ x: i * 0.01, y: i * 0.02, z: 0 }));
}

function makeValidGesture(overrides: Partial<PersonalizedGesture> = {}): PersonalizedGesture {
  const now = Date.now();
  return {
    id: "gesture-1",
    name: "Busy",
    meaning: "I'm busy right now",
    examples: [{ normalizedLandmarks: makeLandmarks(), capturedAt: now }],
    enabled: true,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("isValidPersonalizedGesture", () => {
  it("accepts a well-formed gesture", () => {
    expect(isValidPersonalizedGesture(makeValidGesture())).toBe(true);
  });

  it("rejects a missing name", () => {
    const withoutName: Partial<PersonalizedGesture> = { ...makeValidGesture() };
    delete withoutName.name;
    expect(isValidPersonalizedGesture(withoutName)).toBe(false);
  });

  it("rejects an empty/whitespace-only name", () => {
    expect(isValidPersonalizedGesture(makeValidGesture({ name: "" }))).toBe(false);
    expect(isValidPersonalizedGesture(makeValidGesture({ name: "   " }))).toBe(false);
  });

  it("rejects a missing meaning", () => {
    const withoutMeaning: Partial<PersonalizedGesture> = { ...makeValidGesture() };
    delete withoutMeaning.meaning;
    expect(isValidPersonalizedGesture(withoutMeaning)).toBe(false);
  });

  it("rejects an empty meaning", () => {
    expect(isValidPersonalizedGesture(makeValidGesture({ meaning: "" }))).toBe(false);
  });

  it("rejects a gesture with zero examples", () => {
    expect(isValidPersonalizedGesture(makeValidGesture({ examples: [] }))).toBe(false);
  });

  it("rejects an example with the wrong landmark count", () => {
    const badExamples = [{ normalizedLandmarks: makeLandmarks().slice(0, 10), capturedAt: Date.now() }];
    expect(isValidPersonalizedGesture(makeValidGesture({ examples: badExamples }))).toBe(false);
  });

  it("rejects an example with non-finite landmark coordinates", () => {
    const landmarks = makeLandmarks();
    landmarks[0] = { x: NaN, y: 0, z: 0 };
    const badExamples = [{ normalizedLandmarks: landmarks, capturedAt: Date.now() }];
    expect(isValidPersonalizedGesture(makeValidGesture({ examples: badExamples }))).toBe(false);
  });

  it("rejects an example missing capturedAt", () => {
    const badExamples = [{ normalizedLandmarks: makeLandmarks() }];
    expect(isValidPersonalizedGesture(makeValidGesture({ examples: badExamples as never }))).toBe(false);
  });

  it("rejects non-object input", () => {
    expect(isValidPersonalizedGesture(null)).toBe(false);
    expect(isValidPersonalizedGesture(undefined)).toBe(false);
    expect(isValidPersonalizedGesture("not a gesture")).toBe(false);
    expect(isValidPersonalizedGesture(42)).toBe(false);
  });
});

describe("sanitizeStoredPersonalizedGestures", () => {
  it("returns an empty array for missing storage (undefined)", () => {
    expect(sanitizeStoredPersonalizedGestures(undefined)).toEqual([]);
  });

  it("returns an empty array for a non-array value", () => {
    expect(sanitizeStoredPersonalizedGestures({ not: "an array" })).toEqual([]);
    expect(sanitizeStoredPersonalizedGestures("corrupted")).toEqual([]);
  });

  it("drops malformed entries while keeping valid ones", () => {
    const valid = makeValidGesture({ id: "valid-1" });
    const malformed = [{ id: "bad", name: "", meaning: "x" }, valid, null, "junk", 123];
    expect(sanitizeStoredPersonalizedGestures(malformed)).toEqual([valid]);
  });
});

describe("generatePersonalizedGestureId", () => {
  it("returns a non-empty string", () => {
    const id = generatePersonalizedGestureId();
    expect(typeof id).toBe("string");
    expect(id.length).toBeGreaterThan(0);
  });

  it("generates unique ids across calls", () => {
    const ids = new Set(Array.from({ length: 20 }, () => generatePersonalizedGestureId()));
    expect(ids.size).toBe(20);
  });
});

describe("Phase 10: localizedMeanings (additive, optional field)", () => {
  it("a gesture with no localizedMeanings at all is still valid -- real pre-Phase-10 data (e.g. the saved 'super' gesture) is unaffected", () => {
    const gesture = makeValidGesture();
    expect("localizedMeanings" in gesture).toBe(false);
    expect(isValidPersonalizedGesture(gesture)).toBe(true);
  });

  it("accepts a well-formed localizedMeanings map", () => {
    const gesture = makeValidGesture({ localizedMeanings: { "hi-IN": "बहुत बढ़िया!", "te-IN": "చాలా బాగుంది!" } });
    expect(isValidPersonalizedGesture(gesture)).toBe(true);
  });

  it("rejects an unrecognized language code as a key", () => {
    const gesture = makeValidGesture({
      localizedMeanings: { "fr-FR": "Génial!" } as unknown as PersonalizedGesture["localizedMeanings"],
    });
    expect(isValidPersonalizedGesture(gesture)).toBe(false);
  });

  it("rejects an empty-string translation", () => {
    const gesture = makeValidGesture({ localizedMeanings: { "hi-IN": "" } });
    expect(isValidPersonalizedGesture(gesture)).toBe(false);
  });

  it("rejects a non-object localizedMeanings value", () => {
    const gesture = makeValidGesture({
      localizedMeanings: "not an object" as unknown as PersonalizedGesture["localizedMeanings"],
    });
    expect(isValidPersonalizedGesture(gesture)).toBe(false);
  });
});

describe("getLocalizedMeaning", () => {
  it("returns the localized meaning when present for the requested language", () => {
    const gesture = makeValidGesture({ meaning: "I'm busy", localizedMeanings: { "hi-IN": "मैं व्यस्त हूँ" } });
    expect(getLocalizedMeaning(gesture, "hi-IN")).toBe("मैं व्यस्त हूँ");
  });

  it("falls back to the default `meaning` when no localized translation exists for that language", () => {
    const gesture = makeValidGesture({ meaning: "I'm busy", localizedMeanings: { "hi-IN": "मैं व्यस्त हूँ" } });
    expect(getLocalizedMeaning(gesture, "te-IN")).toBe("I'm busy");
  });

  it("falls back to `meaning` when localizedMeanings is entirely absent (real pre-Phase-10 data)", () => {
    const gesture = makeValidGesture({ meaning: "I'm busy" });
    expect(getLocalizedMeaning(gesture, "hi-IN")).toBe("I'm busy");
  });
});

describe("resolvePersonalizedGestureMeaning (Phase 11 Part B)", () => {
  const gesture = makeValidGesture({
    id: "g-1",
    meaning: "Great!",
    localizedMeanings: { "hi-IN": "बहुत बढ़िया!", "te-IN": "చాలా బాగుంది!" },
  });

  it("resolves the English meaning", () => {
    expect(resolvePersonalizedGestureMeaning([gesture], "g-1", "fallback", "en-IN")).toBe("Great!");
  });

  it("resolves the Hindi translation", () => {
    expect(resolvePersonalizedGestureMeaning([gesture], "g-1", "fallback", "hi-IN")).toBe("बहुत बढ़िया!");
  });

  it("resolves the Telugu translation", () => {
    expect(resolvePersonalizedGestureMeaning([gesture], "g-1", "fallback", "te-IN")).toBe("చాలా బాగుంది!");
  });

  it("falls back to the default meaning when a translation is missing for the requested language", () => {
    const noTelugu = makeValidGesture({ id: "g-2", meaning: "Thanks", localizedMeanings: { "hi-IN": "धन्यवाद" } });
    expect(resolvePersonalizedGestureMeaning([noTelugu], "g-2", "fallback", "te-IN")).toBe("Thanks");
  });

  it("falls back to `fallbackMeaning` (the matcher's own meaning) when the gesture can't be found -- e.g. deleted between match and lookup", () => {
    expect(resolvePersonalizedGestureMeaning([gesture], "missing-id", "matcher fallback text", "hi-IN")).toBe(
      "matcher fallback text",
    );
  });

  it("falls back to `fallbackMeaning` for an empty gesture list", () => {
    expect(resolvePersonalizedGestureMeaning([], "g-1", "matcher fallback text", "en-IN")).toBe(
      "matcher fallback text",
    );
  });
});
