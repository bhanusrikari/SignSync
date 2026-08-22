import { describe, expect, it } from "vitest";
import { summarizeRecognitionStrength, validatePersonalizedGestures } from "./personalizedGestureValidation";
import { FIST, OPEN_HAND, OPEN_HAND_NARROW, THUMB_OUT, buildGesture, jitter } from "./personalizedGestureMatcher.fixtures";
import type { PersonalizedGesture, PersonalizedGestureExample } from "@/types";

describe("validatePersonalizedGestures", () => {
  it("1. no saved gestures", () => {
    const report = validatePersonalizedGestures([]);
    expect(report.gestureCount).toBe(0);
    expect(report.gestures).toEqual([]);
    expect(report.crossGesturePairs).toEqual([]);
    expect(report.summary).toMatch(/no personalized gestures/i);
  });

  it("2. one gesture with one example: leave-one-out is null with an explanatory message", () => {
    const gesture = buildGesture("open-hand", "OpenHand", OPEN_HAND, { jitterSeeds: [1] });
    const report = validatePersonalizedGestures([gesture]);

    expect(report.gestureCount).toBe(1);
    expect(report.gestures[0].exampleCount).toBe(1);
    expect(report.gestures[0].leaveOneOut.baseline).toBeNull();
    expect(report.gestures[0].leaveOneOut.rotationInvariant).toBeNull();
    expect(report.gestures[0].insufficientDataMessage).toMatch(/at least 2/i);
    expect(report.gestures[0].hasEnoughExamples).toBe(false); // 1 < MIN_EXAMPLES (5)
    expect(report.crossGesturePairs).toEqual([]);
    expect(report.summary).toMatch(/limited to a single gesture/i);
  });

  it("3. one gesture with multiple examples: leave-one-out is populated and matches", () => {
    const gesture = buildGesture("open-hand", "OpenHand", OPEN_HAND, { jitterSeeds: [1, 2, 3, 4, 5] });
    const report = validatePersonalizedGestures([gesture]);

    const result = report.gestures[0];
    expect(result.exampleCount).toBe(5);
    expect(result.hasEnoughExamples).toBe(true);
    expect(result.insufficientDataMessage).toBeNull();

    for (const stats of [result.leaveOneOut.baseline, result.leaveOneOut.rotationInvariant]) {
      expect(stats).not.toBeNull();
      expect(stats!.evaluatedCount).toBe(5);
      expect(stats!.matchedCount).toBe(5);
      expect(stats!.failureCount).toBe(0);
      expect(stats!.minDistance).toBeGreaterThanOrEqual(0);
      expect(stats!.maxDistance).toBeGreaterThanOrEqual(stats!.minDistance!);
      expect(stats!.avgDistance).not.toBeNull();
      expect(stats!.minConfidence).toBeGreaterThan(0);
    }
  });

  it("4. multiple gestures: cross-gesture pairs are evaluated", () => {
    const gestures = [
      buildGesture("open-hand", "OpenHand", OPEN_HAND),
      buildGesture("fist", "Fist", FIST),
    ];
    const report = validatePersonalizedGestures(gestures);

    expect(report.gestureCount).toBe(2);
    expect(report.gestures).toHaveLength(2);
    // OpenHand and Fist are well-separated (see Phase 4/5 reports:
    // meanDistance ~0.51), so this pair shouldn't be flagged at all.
    expect(report.crossGesturePairs).toEqual([]);
    expect(report.summary).toMatch(/no false positives detected/i);
  });

  it("5. malformed saved data never throws and is filtered gracefully", () => {
    const malformed: unknown[] = [
      null,
      undefined,
      "not a gesture",
      42,
      { id: "bad" }, // missing name/examples
      { id: "bad2", name: "Bad", examples: "not an array" },
      buildGesture("valid", "Valid", OPEN_HAND, { jitterSeeds: [1, 2] }),
    ];

    expect(() => validatePersonalizedGestures(malformed)).not.toThrow();
    const report = validatePersonalizedGestures(malformed);
    expect(report.gestureCount).toBe(1);
    expect(report.gestures[0].gestureName).toBe("Valid");

    expect(() => validatePersonalizedGestures(null)).not.toThrow();
    expect(() => validatePersonalizedGestures(undefined)).not.toThrow();
    expect(() => validatePersonalizedGestures("garbage")).not.toThrow();
    expect(validatePersonalizedGestures(null).gestureCount).toBe(0);
  });

  it("6. missing/empty examples are handled gracefully", () => {
    const now = Date.now();
    const gestureWithNoExamples: PersonalizedGesture = {
      id: "empty",
      name: "Empty",
      meaning: "x",
      examples: [],
      enabled: true,
      createdAt: now,
      updatedAt: now,
    };
    const report = validatePersonalizedGestures([gestureWithNoExamples]);
    expect(report.gestures[0].exampleCount).toBe(0);
    expect(report.gestures[0].insufficientDataMessage).toMatch(/no usable examples/i);
    expect(report.gestures[0].leaveOneOut.baseline).toBeNull();

    // Malformed individual examples (wrong shape) are filtered out, not fatal.
    const malformedExample = { normalizedLandmarks: [], capturedAt: Date.now() } as PersonalizedGestureExample;
    const gestureWithBadExamples = {
      ...gestureWithNoExamples,
      id: "bad-examples",
      examples: [malformedExample, malformedExample],
    };
    const report2 = validatePersonalizedGestures([gestureWithBadExamples]);
    expect(report2.gestures[0].exampleCount).toBe(0);
  });

  it("7. false-positive candidate detection: an unprotected near-duplicate pair is flagged", () => {
    // OPEN_HAND vs OPEN_HAND_NARROW are close enough (see Phase 4/6 reports)
    // that, as a SINGLE candidate (no second gesture to trigger the
    // ambiguity check), one confidently matches the other -- exactly the
    // scenario this detector exists to surface.
    const gestures = [
      buildGesture("open-hand", "OpenHand", OPEN_HAND),
      buildGesture("open-hand-narrow", "OpenHandNarrow", OPEN_HAND_NARROW),
    ];
    const report = validatePersonalizedGestures(gestures);

    expect(report.crossGesturePairs).toHaveLength(1);
    const pair = report.crossGesturePairs[0];
    expect(pair.flagLabel).toMatch(/near-duplicate names/i); // explicit highlight, matched by name
    expect(pair.falsePositiveBaseline || pair.falsePositiveRotationInvariant).toBe(true);
    expect(report.summary).toMatch(/possible false positive/i);
  });

  it("7b. the Phase 5 Fist/ThumbOut fix shows as protected (contradiction detected, no false positive)", () => {
    const gestures = [buildGesture("fist", "Fist", FIST), buildGesture("thumb-out", "ThumbOut", THUMB_OUT)];
    const report = validatePersonalizedGestures(gestures);

    expect(report.crossGesturePairs).toHaveLength(1);
    const pair = report.crossGesturePairs[0];
    expect(pair.flagLabel).toMatch(/differ only in the thumb/i);
    expect(pair.contradictionDetected).toBe(true);
    expect(pair.falsePositiveBaseline).toBe(false);
    expect(pair.falsePositiveRotationInvariant).toBe(false);
  });

  it('15/17. duplicate gesture names ("super" recorded three times) are disambiguated with #1/#2/#3', () => {
    const gestures = [
      buildGesture("super-a", "super", jitter(OPEN_HAND, 0.02, 1)),
      buildGesture("super-b", "super", jitter(OPEN_HAND, 0.02, 2)),
      buildGesture("super-c", "super", jitter(OPEN_HAND, 0.02, 3)),
    ];
    const report = validatePersonalizedGestures(gestures);

    // Per-gesture display names are numbered in list order.
    expect(report.gestures.map((g) => g.displayName)).toEqual(["super #1", "super #2", "super #3"]);
    // Raw name is preserved separately.
    expect(report.gestures.every((g) => g.gestureName === "super")).toBe(true);
    // Each gets a distinct short id derived from its real (distinct) id.
    expect(new Set(report.gestures.map((g) => g.shortId)).size).toBe(3);

    // All C(3,2)=3 pairs are reported, none showing the ambiguous "super <-> super".
    expect(report.crossGesturePairs).toHaveLength(3);
    for (const pair of report.crossGesturePairs) {
      expect(pair.gestureAName).not.toBe(pair.gestureBName);
      expect(pair.gestureAName).toMatch(/^super #\d$/);
      expect(pair.gestureBName).toMatch(/^super #\d$/);
      expect(pair.flagLabel).toMatch(/duplicate name/i);
      expect(pair.closestExampleIndexA).toBeGreaterThanOrEqual(0);
      expect(pair.closestExampleIndexB).toBeGreaterThanOrEqual(0);
    }
    expect(report.summary).toMatch(/used by more than one gesture record/i);
  });

  it("a unique gesture name is never given a #1 suffix", () => {
    const gestures = [buildGesture("only-one", "OpenHand", OPEN_HAND)];
    const report = validatePersonalizedGestures(gestures);
    expect(report.gestures[0].displayName).toBe("OpenHand");
  });

  it("8. gracefully skips optional named highlights (ThumbOut/OpenHandNarrow) when they don't exist", () => {
    const gestures = [
      buildGesture("open-hand", "OpenHand", OPEN_HAND),
      buildGesture("fist", "Fist", jitter(FIST, 0, 0)),
    ];
    expect(() => validatePersonalizedGestures(gestures)).not.toThrow();
    const report = validatePersonalizedGestures(gestures);
    // Well-separated, no highlight name match possible -- no pairs reported.
    expect(report.crossGesturePairs).toEqual([]);
  });

  it("9. exposes the gesture's meaning for the friendly Validate summary (Phase 10 Part 4)", () => {
    const gesture: PersonalizedGesture = { ...buildGesture("open-hand", "OpenHand", OPEN_HAND), meaning: "Great job!" };
    const report = validatePersonalizedGestures([gesture]);
    expect(report.gestures[0].meaning).toBe("Great job!");
  });

  it("10. exposes localizedMeanings so Validate can show available translations (Phase 11 Part B)", () => {
    const gesture: PersonalizedGesture = {
      ...buildGesture("open-hand", "OpenHand", OPEN_HAND),
      localizedMeanings: { "hi-IN": "बहुत बढ़िया!" },
    };
    const report = validatePersonalizedGestures([gesture]);
    expect(report.gestures[0].localizedMeanings).toEqual({ "hi-IN": "बहुत बढ़िया!" });
  });

  it("11. localizedMeanings is undefined for a gesture that has none (real pre-Phase-10 data)", () => {
    const gesture = buildGesture("open-hand", "OpenHand", OPEN_HAND);
    const report = validatePersonalizedGestures([gesture]);
    expect(report.gestures[0].localizedMeanings).toBeUndefined();
  });
});

describe("summarizeRecognitionStrength (Phase 10 Part 4)", () => {
  it("a well-recorded gesture (many self-matching examples) is rated strong", () => {
    const gesture = buildGesture("open-hand", "OpenHand", OPEN_HAND, { jitterSeeds: [1, 2, 3, 4, 5, 6, 7, 8] });
    const report = validatePersonalizedGestures([gesture]);
    expect(summarizeRecognitionStrength(report.gestures[0])).toBe("strong");
  });

  it("a gesture with too few examples for leave-one-out validation is rated weak, not thrown", () => {
    const gesture = buildGesture("open-hand", "OpenHand", OPEN_HAND, { jitterSeeds: [1] });
    const report = validatePersonalizedGestures([gesture]);
    expect(report.gestures[0].leaveOneOut.rotationInvariant).toBeNull();
    expect(summarizeRecognitionStrength(report.gestures[0])).toBe("weak");
  });

  it("never throws even for a gesture with zero examples", () => {
    const emptyResult = {
      gestureId: "x",
      gestureName: "x",
      displayName: "x",
      meaning: "x",
      shortId: "x",
      exampleCount: 0,
      enabled: true,
      hasEnoughExamples: false,
      leaveOneOut: { baseline: null, rotationInvariant: null },
      insufficientDataMessage: "No usable examples were found for this gesture.",
    };
    expect(() => summarizeRecognitionStrength(emptyResult)).not.toThrow();
    expect(summarizeRecognitionStrength(emptyResult)).toBe("weak");
  });
});
