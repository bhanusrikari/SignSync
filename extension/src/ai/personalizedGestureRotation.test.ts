import { describe, expect, it } from "vitest";
import {
  matchPersonalizedGestureRotationInvariant,
  normalizeInPlaneOnly,
  normalizePersonalizedLandmarks,
} from "./personalizedGestureRotation";
import {
  FIST,
  OPEN_HAND,
  OPEN_HAND_NARROW,
  POINT_LIKE,
  THREE_FINGERS_LIKE,
  THUMB_OUT,
  TWO_FINGERS,
  buildGesture,
  jitter,
  rotateY,
  rotateZ,
} from "./personalizedGestureMatcher.fixtures";
import type { Point3D } from "./gestureTypes";

const Z_ANGLES = [0, 3, 10, 20, 30, 45];

describe("Phase 6 regression: rotation (Approach B)", () => {
  it.each(Z_ANGLES)("Z-axis %d deg: rotated OpenHand still matches a clean OpenHand example", (degrees) => {
    const gesture = buildGesture("open-hand", "OpenHand", OPEN_HAND, { jitterSeeds: [0], jitterMagnitude: 0 });
    const result = matchPersonalizedGestureRotationInvariant(rotateZ(OPEN_HAND, degrees), [gesture]);
    expect(result.matched).toBe(true);
    expect(result.gestureId).toBe("open-hand");
    expect(result.distance).toBeLessThan(0.01);
  });

  it.each(Z_ANGLES)("Y-axis %d deg: rotated OpenHand still matches a clean OpenHand example", (degrees) => {
    const gesture = buildGesture("open-hand", "OpenHand", OPEN_HAND, { jitterSeeds: [0], jitterMagnitude: 0 });
    const result = matchPersonalizedGestureRotationInvariant(rotateY(OPEN_HAND, degrees), [gesture]);
    expect(result.matched).toBe(true);
    expect(result.gestureId).toBe("open-hand");
    expect(result.distance).toBeLessThan(0.01);
  });
});

describe("Phase 6 regression: existing behavior preserved under rotation normalization", () => {
  it("genuine gesture matching: all four base shapes still match themselves", () => {
    for (const [base, id] of [
      [FIST, "fist"],
      [THUMB_OUT, "thumb-out"],
      [OPEN_HAND, "open-hand"],
      [TWO_FINGERS, "two-fingers"],
    ] as const) {
      const gesture = buildGesture(id, id, base);
      const result = matchPersonalizedGestureRotationInvariant(jitter(base, 0.02, 99), [gesture]);
      expect(result.matched).toBe(true);
      expect(result.gestureId).toBe(id);
    }
  });

  it("small natural noise still matches", () => {
    const gesture = buildGesture("open-hand", "OpenHand", OPEN_HAND);
    const result = matchPersonalizedGestureRotationInvariant(jitter(OPEN_HAND, 0.02, 7), [gesture]);
    expect(result.matched).toBe(true);
  });

  describe("Fist <-> ThumbOut false-positive fix (Phase 5) remains intact", () => {
    it("Fist query does not match a stored ThumbOut example", () => {
      const thumbOutGesture = buildGesture("thumb-out", "ThumbOut", THUMB_OUT);
      const result = matchPersonalizedGestureRotationInvariant(jitter(FIST, 0.02, 42), [thumbOutGesture]);
      expect(result.matched).toBe(false);
    });

    it("ThumbOut query does not match a stored Fist example", () => {
      const fistGesture = buildGesture("fist", "Fist", FIST);
      const result = matchPersonalizedGestureRotationInvariant(jitter(THUMB_OUT, 0.02, 42), [fistGesture]);
      expect(result.matched).toBe(false);
    });

    it("the false positive stays fixed even when the query is also rotated", () => {
      const thumbOutGesture = buildGesture("thumb-out", "ThumbOut", THUMB_OUT);
      const result = matchPersonalizedGestureRotationInvariant(rotateZ(FIST, 25), [thumbOutGesture]);
      expect(result.matched).toBe(false);
    });
  });

  it("OpenHand <-> OpenHandNarrow ambiguity mechanism (Phase 4) remains intact", () => {
    const openHandGesture = buildGesture("open-hand", "OpenHand", OPEN_HAND);
    const openHandNarrowGesture = buildGesture("open-hand-narrow", "OpenHandNarrow", OPEN_HAND_NARROW);
    const query = jitter(OPEN_HAND, 0.01, 7);
    const result = matchPersonalizedGestureRotationInvariant(query, [openHandGesture, openHandNarrowGesture]);
    expect(result.matched).toBe(false); // ambiguous, same as the unrotated matcher
  });

  it("additional concentrated-difference cases (Phase 5) remain rejected", () => {
    const fistGesture = buildGesture("fist", "Fist", FIST);
    const pointGesture = buildGesture("point", "Point", POINT_LIKE);
    expect(matchPersonalizedGestureRotationInvariant(jitter(FIST, 0.02, 5), [pointGesture]).matched).toBe(false);
    expect(matchPersonalizedGestureRotationInvariant(jitter(POINT_LIKE, 0.02, 5), [fistGesture]).matched).toBe(false);

    const twoFingersGesture = buildGesture("two-fingers", "TwoFingers", TWO_FINGERS);
    const threeFingersGesture = buildGesture("three-fingers", "ThreeFingers", THREE_FINGERS_LIKE);
    expect(
      matchPersonalizedGestureRotationInvariant(jitter(TWO_FINGERS, 0.02, 5), [threeFingersGesture]).matched,
    ).toBe(false);
    expect(
      matchPersonalizedGestureRotationInvariant(jitter(THREE_FINGERS_LIKE, 0.02, 5), [twoFingersGesture]).matched,
    ).toBe(false);
  });
});

describe("Phase 6 regression: invalid input / degenerate geometry never throws or produces non-finite output", () => {
  it("normalizePersonalizedLandmarks never returns non-finite coordinates", () => {
    const cases: Point3D[][] = [
      OPEN_HAND, // normal case
      OPEN_HAND.slice(0, 5), // wrong count
      OPEN_HAND.map((p, i) => (i === 0 ? { x: 0, y: 0, z: 0 } : p)), // wrist at origin (degenerate up-axis)
      OPEN_HAND.map((p, i) => (i === 17 ? { ...OPEN_HAND[5] } : p)), // pinky MCP == index MCP (zero width vector)
      OPEN_HAND.map((p, i) => (i === 10 ? { x: NaN, y: Infinity, z: -Infinity } : p)), // corrupted landmark
    ];
    for (const landmarks of cases) {
      const result = normalizePersonalizedLandmarks(landmarks);
      expect(result.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z))).toBe(true);
    }
  });

  it("normalizeInPlaneOnly never returns non-finite coordinates", () => {
    const degenerate = OPEN_HAND.map((p, i) => (i === 17 ? { ...OPEN_HAND[5] } : p));
    const result = normalizeInPlaneOnly(degenerate);
    expect(result.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z))).toBe(true);
  });

  it("matchPersonalizedGestureRotationInvariant never throws on malformed input", () => {
    const gesture = buildGesture("open-hand", "OpenHand", OPEN_HAND);
    expect(() => matchPersonalizedGestureRotationInvariant(null, [gesture])).not.toThrow();
    expect(() => matchPersonalizedGestureRotationInvariant(undefined, [gesture])).not.toThrow();
    expect(() => matchPersonalizedGestureRotationInvariant(OPEN_HAND, null)).not.toThrow();
    expect(() => matchPersonalizedGestureRotationInvariant(OPEN_HAND.slice(0, 3), [gesture])).not.toThrow();
    expect(matchPersonalizedGestureRotationInvariant(null, [gesture]).matched).toBe(false);
  });

  it("a gesture whose stored example has a degenerate wrist still produces a finite, non-throwing result", () => {
    const degenerateExample = OPEN_HAND.map((p, i) => (i === 0 ? { x: 0, y: 0, z: 0 } : p));
    const gesture = buildGesture("open-hand", "OpenHand", degenerateExample, {
      jitterSeeds: [0],
      jitterMagnitude: 0,
    });
    const result = matchPersonalizedGestureRotationInvariant(OPEN_HAND, [gesture]);
    expect(Number.isFinite(result.distance) || result.distance === Infinity).toBe(true);
    expect(Number.isFinite(result.confidence)).toBe(true);
  });
});
