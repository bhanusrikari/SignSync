import { describe, expect, it } from "vitest";
import {
  AMBIGUITY_MARGIN,
  MAX_ACCEPTABLE_DISTANCE,
  MIN_MATCH_CONFIDENCE,
  matchPersonalizedGesture,
} from "./personalizedGestureMatcher";
import {
  FIST,
  OPEN_HAND,
  POINT_LIKE,
  THREE_FINGERS_LIKE,
  THUMB_OUT,
  TWO_FINGERS,
  buildGesture,
  jitter,
} from "./personalizedGestureMatcher.fixtures";
import type { Point3D } from "./gestureTypes";
import type { PersonalizedGesture, PersonalizedGestureExample } from "@/types";

/**
 * Every landmark in this fixture is offset from index `i` by the SAME
 * (dx, dy, dz) delta, so meanLandmarkDistance(makeLandmarks(), makeLandmarks(dx,dy,dz))
 * is exactly sqrt(dx^2 + dy^2 + dz^2) -- lets tests assert exact,
 * predictable distances instead of approximations.
 */
function makeLandmarks(dx = 0, dy = 0, dz = 0): Point3D[] {
  return Array.from({ length: 21 }, (_, i) => ({ x: i * 0.01 + dx, y: i * 0.02 + dy, z: dz }));
}

function makeExample(landmarks: Point3D[]): PersonalizedGestureExample {
  return { normalizedLandmarks: landmarks, capturedAt: Date.now() };
}

function makeGesture(overrides: Partial<PersonalizedGesture> = {}): PersonalizedGesture {
  const now = Date.now();
  return {
    id: "gesture-1",
    name: "Busy",
    meaning: "I'm busy right now",
    examples: [makeExample(makeLandmarks())],
    enabled: true,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("matchPersonalizedGesture", () => {
  it("1. exact match is recognized with very high confidence", () => {
    const gesture = makeGesture({ examples: [makeExample(makeLandmarks())] });
    const result = matchPersonalizedGesture(makeLandmarks(), [gesture]);

    expect(result.matched).toBe(true);
    expect(result.gestureId).toBe("gesture-1");
    expect(result.name).toBe("Busy");
    expect(result.meaning).toBe("I'm busy right now");
    expect(result.distance).toBeCloseTo(0, 10);
    expect(result.confidence).toBeCloseTo(1, 10);
  });

  it("2. small movement/noise is still recognized", () => {
    const gesture = makeGesture({ examples: [makeExample(makeLandmarks())] });
    // Tiny offset, well inside MAX_ACCEPTABLE_DISTANCE and the confidence bar.
    const result = matchPersonalizedGesture(makeLandmarks(0.01), [gesture]);

    expect(result.matched).toBe(true);
    expect(result.gestureId).toBe("gesture-1");
    expect(result.distance).toBeCloseTo(0.01, 10);
    expect(result.confidence).toBeGreaterThan(MIN_MATCH_CONFIDENCE);
  });

  it("3. large movement is UNKNOWN (no match)", () => {
    const gesture = makeGesture({ examples: [makeExample(makeLandmarks())] });
    const result = matchPersonalizedGesture(makeLandmarks(5), [gesture]);

    expect(result.matched).toBe(false);
    expect(result.gestureId).toBeNull();
    expect(result.distance).toBeGreaterThan(MAX_ACCEPTABLE_DISTANCE);
    expect(result.confidence).toBe(0);
  });

  it("4. a disabled personalized gesture is ignored completely", () => {
    const gesture = makeGesture({ enabled: false, examples: [makeExample(makeLandmarks())] });
    const result = matchPersonalizedGesture(makeLandmarks(), [gesture]);

    expect(result.matched).toBe(false);
    expect(result.gestureId).toBeNull();
    // Nothing was comparable at all -- distinct from "compared but too far".
    expect(result.distance).toBe(Infinity);
  });

  it("5. no personalized gestures returns UNKNOWN with distance Infinity", () => {
    const result = matchPersonalizedGesture(makeLandmarks(), []);

    expect(result.matched).toBe(false);
    expect(result.gestureId).toBeNull();
    expect(result.distance).toBe(Infinity);
    expect(result.confidence).toBe(0);
  });

  it("6. invalid landmarks (wrong count, non-finite, or missing) yield UNKNOWN", () => {
    const gesture = makeGesture({ examples: [makeExample(makeLandmarks())] });

    expect(matchPersonalizedGesture(undefined, [gesture]).matched).toBe(false);
    expect(matchPersonalizedGesture(null, [gesture]).matched).toBe(false);
    expect(matchPersonalizedGesture(makeLandmarks().slice(0, 5), [gesture]).matched).toBe(false);

    const withNaN = makeLandmarks();
    withNaN[3] = { x: NaN, y: 0, z: 0 };
    expect(matchPersonalizedGesture(withNaN, [gesture]).matched).toBe(false);

    const withInfinity = makeLandmarks();
    withInfinity[3] = { x: 0, y: Infinity, z: 0 };
    expect(matchPersonalizedGesture(withInfinity, [gesture]).matched).toBe(false);
  });

  it("7. with multiple distinct gestures, the closest valid one is selected", () => {
    const gestureA = makeGesture({ id: "a", name: "Busy", examples: [makeExample(makeLandmarks(0))] });
    const gestureB = makeGesture({ id: "b", name: "Later", examples: [makeExample(makeLandmarks(0.5))] });
    const gestureC = makeGesture({ id: "c", name: "Thanks", examples: [makeExample(makeLandmarks(1))] });

    const result = matchPersonalizedGesture(makeLandmarks(0.02), [gestureA, gestureB, gestureC]);

    expect(result.matched).toBe(true);
    expect(result.gestureId).toBe("a");
  });

  it("8. two nearly identical gestures trigger ambiguity protection (no confident selection)", () => {
    const gestureA = makeGesture({ id: "a", examples: [makeExample(makeLandmarks(0))] });
    // Distance between A's and B's examples is 0.03, well under AMBIGUITY_MARGIN (0.05).
    const gestureB = makeGesture({ id: "b", examples: [makeExample(makeLandmarks(0.03))] });

    const result = matchPersonalizedGesture(makeLandmarks(0), [gestureA, gestureB]);

    expect(result.matched).toBe(false);
    expect(result.gestureId).toBeNull();
    // The best distance is still reported for diagnostics even though the
    // match was rejected for ambiguity, not for being too far.
    expect(result.distance).toBeCloseTo(0, 10);
  });

  it("8b. a sufficient margin between two similar gestures is NOT treated as ambiguous", () => {
    const gestureA = makeGesture({ id: "a", examples: [makeExample(makeLandmarks(0))] });
    // Gap is well beyond AMBIGUITY_MARGIN.
    const gestureB = makeGesture({ id: "b", examples: [makeExample(makeLandmarks(AMBIGUITY_MARGIN * 5))] });

    const result = matchPersonalizedGesture(makeLandmarks(0), [gestureA, gestureB]);

    expect(result.matched).toBe(true);
    expect(result.gestureId).toBe("a");
  });

  it("9. multiple examples for one gesture: the best (closest) example determines distance", () => {
    const gesture = makeGesture({
      examples: [makeExample(makeLandmarks(0.5)), makeExample(makeLandmarks(0.01))],
    });

    const result = matchPersonalizedGesture(makeLandmarks(0), [gesture]);

    expect(result.matched).toBe(true);
    expect(result.distance).toBeCloseTo(0.01, 10);
  });

  it("10. confidence always stays within [0, 1]", () => {
    const gesture = makeGesture({ examples: [makeExample(makeLandmarks(0))] });

    const exact = matchPersonalizedGesture(makeLandmarks(0), [gesture]);
    expect(exact.confidence).toBeLessThanOrEqual(1);
    expect(exact.confidence).toBeGreaterThanOrEqual(0);

    const veryFar = matchPersonalizedGesture(makeLandmarks(1000), [gesture]);
    expect(veryFar.confidence).toBeLessThanOrEqual(1);
    expect(veryFar.confidence).toBeGreaterThanOrEqual(0);
    expect(veryFar.confidence).toBe(0);

    const none = matchPersonalizedGesture(makeLandmarks(0), []);
    expect(none.confidence).toBe(0);
  });

  describe("additional robustness", () => {
    it("skips malformed individual examples but still matches on the valid ones", () => {
      const malformedExample = { normalizedLandmarks: makeLandmarks().slice(0, 3), capturedAt: Date.now() };
      const gesture = makeGesture({
        examples: [malformedExample as PersonalizedGestureExample, makeExample(makeLandmarks())],
      });

      const result = matchPersonalizedGesture(makeLandmarks(), [gesture]);
      expect(result.matched).toBe(true);
      expect(result.gestureId).toBe("gesture-1");
    });

    it("treats a gesture whose examples are ALL malformed as having no candidate", () => {
      const malformedExample = { normalizedLandmarks: [], capturedAt: Date.now() };
      const gesture = makeGesture({ examples: [malformedExample as PersonalizedGestureExample] });

      const result = matchPersonalizedGesture(makeLandmarks(), [gesture]);
      expect(result.matched).toBe(false);
      expect(result.distance).toBe(Infinity);
    });

    it("skips a malformed gesture object in the list without throwing", () => {
      const validGesture = makeGesture({ id: "valid" });
      const malformedGesture = { id: "bad" } as unknown as PersonalizedGesture;

      expect(() =>
        matchPersonalizedGesture(makeLandmarks(), [malformedGesture, validGesture]),
      ).not.toThrow();
      const result = matchPersonalizedGesture(makeLandmarks(), [malformedGesture, validGesture]);
      expect(result.matched).toBe(true);
      expect(result.gestureId).toBe("valid");
    });

    it("does not throw when the gesture list itself is malformed", () => {
      expect(() => matchPersonalizedGesture(makeLandmarks(), null)).not.toThrow();
      expect(() => matchPersonalizedGesture(makeLandmarks(), undefined)).not.toThrow();
      expect(matchPersonalizedGesture(makeLandmarks(), null).matched).toBe(false);
    });

    it("a distance just beyond MAX_ACCEPTABLE_DISTANCE is rejected by the distance gate", () => {
      const gesture = makeGesture({ examples: [makeExample(makeLandmarks(0))] });
      const result = matchPersonalizedGesture(makeLandmarks(MAX_ACCEPTABLE_DISTANCE + 0.01), [gesture]);
      expect(result.matched).toBe(false);
      expect(result.distance).toBeGreaterThan(MAX_ACCEPTABLE_DISTANCE);
    });
  });
});

/**
 * Phase 5 permanent regression tests: the confirmed Fist/ThumbOut false
 * positive (Phase 4) and its generalization, using the SAME synthetic hand
 * shapes from personalizedGestureMatcher.fixtures.ts (not reinvented
 * fixtures) so these tests directly cover the actual reported case rather
 * than an approximation of it.
 */
describe("matchPersonalizedGesture -- Phase 5 concentrated-difference regression", () => {
  describe("1. Fist vs ThumbOut", () => {
    const fistGesture = buildGesture("fist", "Fist", FIST);
    const thumbOutGesture = buildGesture("thumb-out", "ThumbOut", THUMB_OUT);

    it("a Fist query does not match a stored ThumbOut example", () => {
      const result = matchPersonalizedGesture(jitter(FIST, 0.02, 42), [thumbOutGesture]);
      expect(result.matched).toBe(false);
    });

    it("a ThumbOut query does not match a stored Fist example", () => {
      const result = matchPersonalizedGesture(jitter(THUMB_OUT, 0.02, 42), [fistGesture]);
      expect(result.matched).toBe(false);
    });

    it("neither is confidently accepted as the other even when both are present", () => {
      const fistQueryResult = matchPersonalizedGesture(jitter(FIST, 0.02, 42), [fistGesture, thumbOutGesture]);
      expect(fistQueryResult.matched).toBe(true);
      expect(fistQueryResult.gestureId).toBe("fist"); // correctly picks its OWN gesture, not the confusable one

      const thumbOutQueryResult = matchPersonalizedGesture(jitter(THUMB_OUT, 0.02, 42), [fistGesture, thumbOutGesture]);
      expect(thumbOutQueryResult.matched).toBe(true);
      expect(thumbOutQueryResult.gestureId).toBe("thumb-out");
    });
  });

  describe("2. single-candidate case (must not rely on the ambiguity/second-best check)", () => {
    it("rejects Fist-as-ThumbOut with only ThumbOut as a candidate -- no second candidate exists", () => {
      const thumbOutGesture = buildGesture("thumb-out", "ThumbOut", THUMB_OUT);
      const result = matchPersonalizedGesture(jitter(FIST, 0.02, 42), [thumbOutGesture]);
      // Confirms rejection came from the contradiction check, not the
      // ambiguity margin (there was nothing to be ambiguous WITH).
      expect(result.matched).toBe(false);
      expect(result.gestureId).toBeNull();
    });

    it("rejects ThumbOut-as-Fist with only Fist as a candidate", () => {
      const fistGesture = buildGesture("fist", "Fist", FIST);
      const result = matchPersonalizedGesture(jitter(THUMB_OUT, 0.02, 42), [fistGesture]);
      expect(result.matched).toBe(false);
    });
  });

  describe("3. genuine matching still works", () => {
    const shapes: Array<[string, Point3D[], string]> = [
      ["Fist", FIST, "fist"],
      ["ThumbOut", THUMB_OUT, "thumb-out"],
      ["OpenHand", OPEN_HAND, "open-hand"],
      ["TwoFingers", TWO_FINGERS, "two-fingers"],
    ];
    for (const [label, base, expectedId] of shapes) {
      it(`${label} matches ${label}`, () => {
        const gesture = buildGesture(expectedId, label, base);
        const result = matchPersonalizedGesture(jitter(base, 0.02, 99), [gesture]);
        expect(result.matched).toBe(true);
        expect(result.gestureId).toBe(expectedId);
      });
    }
  });

  describe("4. small natural noise still matches", () => {
    it("realistic small perturbations across all four shapes are still recognized", () => {
      for (const [base, id] of [
        [FIST, "fist"],
        [THUMB_OUT, "thumb-out"],
        [OPEN_HAND, "open-hand"],
        [TWO_FINGERS, "two-fingers"],
      ] as const) {
        const gesture = buildGesture(id, id, base);
        const result = matchPersonalizedGesture(jitter(base, 0.02, 7), [gesture]);
        expect(result.matched).toBe(true);
      }
    });
  });

  describe("7. additional concentrated-difference pairs (no gesture-specific rules)", () => {
    it("Fist vs Point-like (differ only in the index finger) do not confuse each other", () => {
      const fistGesture = buildGesture("fist", "Fist", FIST);
      const pointGesture = buildGesture("point", "Point", POINT_LIKE);

      expect(matchPersonalizedGesture(jitter(FIST, 0.02, 5), [pointGesture]).matched).toBe(false);
      expect(matchPersonalizedGesture(jitter(POINT_LIKE, 0.02, 5), [fistGesture]).matched).toBe(false);
      // Genuine matches still work when both are present.
      expect(matchPersonalizedGesture(jitter(FIST, 0.02, 5), [fistGesture, pointGesture]).gestureId).toBe("fist");
      expect(matchPersonalizedGesture(jitter(POINT_LIKE, 0.02, 5), [fistGesture, pointGesture]).gestureId).toBe(
        "point",
      );
    });

    it("TwoFingers vs ThreeFingers-like (differ only in the ring finger) do not confuse each other", () => {
      const twoFingersGesture = buildGesture("two-fingers", "TwoFingers", TWO_FINGERS);
      const threeFingersGesture = buildGesture("three-fingers", "ThreeFingers", THREE_FINGERS_LIKE);

      expect(matchPersonalizedGesture(jitter(TWO_FINGERS, 0.02, 5), [threeFingersGesture]).matched).toBe(false);
      expect(matchPersonalizedGesture(jitter(THREE_FINGERS_LIKE, 0.02, 5), [twoFingersGesture]).matched).toBe(false);
      expect(
        matchPersonalizedGesture(jitter(TWO_FINGERS, 0.02, 5), [twoFingersGesture, threeFingersGesture]).gestureId,
      ).toBe("two-fingers");
      expect(
        matchPersonalizedGesture(jitter(THREE_FINGERS_LIKE, 0.02, 5), [twoFingersGesture, threeFingersGesture])
          .gestureId,
      ).toBe("three-fingers");
    });
  });
});
