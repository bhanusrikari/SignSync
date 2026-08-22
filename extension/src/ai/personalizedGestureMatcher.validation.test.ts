/**
 * Phase 4 validation harness for personalizedGestureMatcher.ts.
 *
 * IMPORTANT HONESTY NOTE: this file does NOT use real MediaPipe camera
 * captures. There is no way to drive a real webcam/browser from this
 * environment, so real record.html-captured data was not available. Instead
 * this uses the synthetic, deterministic, topologically-faithful
 * 21-landmark hand fixtures in personalizedGestureMatcher.fixtures.ts (same
 * joint layout documented in gestureFeatures.ts: 0 wrist, 1-4 thumb, 5-8
 * index, 9-12 middle, 13-16 ring, 17-20 pinky), built directly in the
 * palm-centered/scale-normalized space the matcher consumes, with exact,
 * reproducible geometric transforms (jitter, rotation) applied.
 *
 * This is legitimate for answering the ROTATION-SENSITIVITY question
 * precisely (rotation sensitivity is a property of the distance metric +
 * the normalization math, not of MediaPipe's specific detection noise --
 * see the Phase 4 report's section C for the exact numbers this file
 * produces) and, as of Phase 5, for confirming the concentrated-difference
 * false-positive fix without depending on any single gesture pair. It is
 * NOT a substitute for validating against a real user's actual recorded
 * examples and live frames -- see the Phase 4/5 reports for exactly how to
 * re-run this kind of analysis against real exported data later
 * (matchPersonalizedGesture() accepts the same PersonalizedGesture[] shape
 * chrome.storage.local already stores).
 *
 * Kept isolated: not imported by offscreen.ts or any other production code
 * path, does not touch chrome APIs, DOM, MediaPipe, or React, and does not
 * add any new message type, stabilizer, or UI.
 *
 * Permanent Fist/ThumbOut-class REGRESSION tests live in
 * personalizedGestureMatcher.test.ts, not here -- this file is exploratory
 * diagnostics (console.log-heavy, some tests deliberately have no strict
 * pass/fail assertion because they exist to OBSERVE and report numbers).
 */
import { describe, expect, it } from "vitest";
import { AMBIGUITY_MARGIN, MAX_ACCEPTABLE_DISTANCE, MIN_MATCH_CONFIDENCE, matchPersonalizedGesture } from "./personalizedGestureMatcher";
import {
  FIST,
  OPEN_HAND,
  OPEN_HAND_NARROW,
  PARTIAL_CURL,
  THUMB_OUT,
  TWO_FINGERS,
  buildGesture,
  jitter,
  rotateY,
  rotateZ,
} from "./personalizedGestureMatcher.fixtures";
import type { Point3D } from "./gestureTypes";
import type { PersonalizedGesture, PersonalizedGestureExample } from "@/types";

const openHandGesture = buildGesture("open-hand", "OpenHand", OPEN_HAND);
const fistGesture = buildGesture("fist", "Fist", FIST);
const twoFingersGesture = buildGesture("two-fingers", "TwoFingers", TWO_FINGERS);
const thumbOutGesture = buildGesture("thumb-out", "ThumbOut", THUMB_OUT);
const openHandNarrowGesture = buildGesture("open-hand-narrow", "OpenHandNarrow", OPEN_HAND_NARROW);

const FIVE_GESTURES = [openHandGesture, fistGesture, twoFingersGesture, thumbOutGesture, openHandNarrowGesture];
// The narrow variant is intentionally excluded from the main 4-gesture set
// used for same/cross-gesture reporting -- it's used specifically in the
// ambiguity experiment below, alongside openHandGesture.
const FOUR_GESTURES = [openHandGesture, fistGesture, twoFingersGesture, thumbOutGesture];

describe("Phase 4 validation: same-gesture recognition (synthetic data)", () => {
  it.each([
    ["OpenHand", OPEN_HAND, "open-hand"],
    ["Fist", FIST, "fist"],
    ["TwoFingers", TWO_FINGERS, "two-fingers"],
    ["ThumbOut", THUMB_OUT, "thumb-out"],
  ] as const)("recognizes a fresh live-frame-like sample of %s", (label, base, expectedId) => {
    // A "fresh" query: jittered with a seed NOT used by any stored example
    // (99), simulating a new live frame rather than replaying a stored one.
    const query = jitter(base, 0.02, 99);
    const result = matchPersonalizedGesture(query, FOUR_GESTURES);

    console.log(
      `[same-gesture] ${label}: matched=${result.matched} gestureId=${result.gestureId} ` +
        `distance=${result.distance.toFixed(4)} confidence=${result.confidence.toFixed(4)}`,
    );

    expect(result.matched).toBe(true);
    expect(result.gestureId).toBe(expectedId);
    expect(result.distance).toBeLessThan(MAX_ACCEPTABLE_DISTANCE);
    expect(result.confidence).toBeGreaterThanOrEqual(MIN_MATCH_CONFIDENCE);
  });
});

describe("Phase 4 validation: cross-gesture distances (false-positive check)", () => {
  it.each([
    ["OpenHand query vs Fist/TwoFingers/ThumbOut stored", OPEN_HAND, "open-hand"],
    ["Fist query vs OpenHand/TwoFingers/ThumbOut stored", FIST, "fist"],
    ["TwoFingers query vs OpenHand/Fist/ThumbOut stored", TWO_FINGERS, "two-fingers"],
    ["ThumbOut query vs OpenHand/Fist/TwoFingers stored", THUMB_OUT, "thumb-out"],
  ] as const)("%s: reports whether an unrelated gesture is confidently selected as a stand-in", (_label, base, ownId) => {
    const query = jitter(base, 0.02, 42);
    const others = FOUR_GESTURES.filter((g) => g.id !== ownId);

    const resultAgainstOthersOnly = matchPersonalizedGesture(query, others);
    console.log(
      `[cross-gesture] ${ownId} vs unrelated-only set: matched=${resultAgainstOthersOnly.matched} ` +
        `distance=${resultAgainstOthersOnly.distance.toFixed(4)} confidence=${resultAgainstOthersOnly.confidence.toFixed(4)}` +
        (resultAgainstOthersOnly.matched
          ? ` -- FALSE POSITIVE: ${ownId}'s query was confidently matched to a DIFFERENT stored gesture (${resultAgainstOthersOnly.gestureId})`
          : ""),
    );

    // As of the Phase 5 fix, this is now a hard assertion (was
    // observational-only during Phase 4, when Fist/ThumbOut genuinely
    // false-positived here) -- see personalizedGestureMatcher.test.ts for
    // the dedicated permanent regression tests of this exact scenario.
    expect(resultAgainstOthersOnly.matched).toBe(false);
  });

  it("reports the actual pairwise distance for every gesture pair (diagnostic)", () => {
    const bases: Array<[string, Point3D[]]> = [
      ["OpenHand", OPEN_HAND],
      ["Fist", FIST],
      ["TwoFingers", TWO_FINGERS],
      ["ThumbOut", THUMB_OUT],
    ];
    for (const [nameA, a] of bases) {
      for (const [nameB, b] of bases) {
        if (nameA >= nameB) continue;
        const count = Math.min(a.length, b.length);
        let total = 0;
        for (let i = 0; i < count; i++) {
          const dx = a[i].x - b[i].x;
          const dy = a[i].y - b[i].y;
          const dz = a[i].z - b[i].z;
          total += Math.sqrt(dx * dx + dy * dy + dz * dz);
        }
        console.log(`[pairwise] ${nameA} <-> ${nameB}: meanDistance=${(total / count).toFixed(4)}`);
      }
    }
    expect(true).toBe(true);
  });
});

describe("Phase 4 validation: rotation sensitivity (the key experiment, unaffected by the Phase 5 fix)", () => {
  // Single clean example, no jitter mixed in, to isolate rotation as the
  // only variable.
  const gesture: PersonalizedGesture = buildGesture("open-hand-clean", "OpenHand", OPEN_HAND, {
    jitterSeeds: [0],
    jitterMagnitude: 0,
  });

  it.each([
    ["Test A: near-identical orientation", 3],
    ["Test B: moderate rotation", 20],
    ["Test C: substantial rotation", 45],
  ] as const)("%s (Z-axis, %d deg)", (label, degrees) => {
    const rotated = rotateZ(OPEN_HAND, degrees);
    const result = matchPersonalizedGesture(rotated, [gesture]);
    console.log(
      `[rotation-Z] ${label} (${degrees} deg): matched=${result.matched} ` +
        `distance=${result.distance.toFixed(4)} confidence=${result.confidence.toFixed(4)} ` +
        `(MAX_ACCEPTABLE_DISTANCE=${MAX_ACCEPTABLE_DISTANCE})`,
    );
    // No assertion here by design -- this test exists to OBSERVE and report
    // the numbers (see the Phase 4 report), not to encode an assumed
    // pass/fail expectation about rotation tolerance. Rotation is
    // explicitly OUT OF SCOPE for the Phase 5 fix (see that report) --
    // these numbers are expected to be identical to Phase 4's.
  });

  it.each([
    ["Test A: near-identical orientation", 3],
    ["Test B: moderate rotation", 20],
    ["Test C: substantial rotation", 45],
  ] as const)("%s (Y-axis, %d deg)", (label, degrees) => {
    const rotated = rotateY(OPEN_HAND, degrees);
    const result = matchPersonalizedGesture(rotated, [gesture]);
    console.log(
      `[rotation-Y] ${label} (${degrees} deg): matched=${result.matched} ` +
        `distance=${result.distance.toFixed(4)} confidence=${result.confidence.toFixed(4)}`,
    );
  });

  it("very small rotation (3 deg) is still recognized", () => {
    const result = matchPersonalizedGesture(rotateZ(OPEN_HAND, 3), [gesture]);
    expect(result.matched).toBe(true);
  });

  it("documents whether moderate rotation (20 deg) alone crosses the acceptance threshold", () => {
    const result = matchPersonalizedGesture(rotateZ(OPEN_HAND, 20), [gesture]);
    console.log(`[rotation summary] 20deg distance=${result.distance.toFixed(4)} matched=${result.matched}`);
    expect(typeof result.matched).toBe("boolean");
  });
});

describe("Phase 4 validation: ambiguity between two similar-but-distinct gestures", () => {
  it("OpenHand vs OpenHandNarrow: a query near either one is treated as ambiguous, not confidently picked", () => {
    const query = jitter(OPEN_HAND, 0.01, 7);
    const result = matchPersonalizedGesture(query, [openHandGesture, openHandNarrowGesture]);
    console.log(
      `[ambiguity] OpenHand vs OpenHandNarrow: matched=${result.matched} distance=${result.distance.toFixed(4)} ` +
        `confidence=${result.confidence.toFixed(4)} (AMBIGUITY_MARGIN=${AMBIGUITY_MARGIN})`,
    );
    expect(result.matched).toBe(false);
  });
});

describe("Phase 4 validation: false positives / robustness (richer 5-gesture set)", () => {
  it("an incomplete/in-transition pose (halfway between OpenHand and Fist) is not confidently matched", () => {
    const result = matchPersonalizedGesture(PARTIAL_CURL, FOUR_GESTURES);
    console.log(
      `[incomplete-gesture] PARTIAL_CURL: matched=${result.matched} distance=${result.distance.toFixed(4)} ` +
        `confidence=${result.confidence.toFixed(4)}`,
    );
    expect(result.matched).toBe(false);
  });

  it("heavy noise on OpenHand may or may not match depending on magnitude -- reports the crossover", () => {
    const lightNoise = matchPersonalizedGesture(jitter(OPEN_HAND, 0.05, 11), [openHandGesture]);
    const heavyNoise = matchPersonalizedGesture(jitter(OPEN_HAND, 0.2, 11), [openHandGesture]);
    console.log(
      `[noise] light(0.05): matched=${lightNoise.matched} distance=${lightNoise.distance.toFixed(4)} | ` +
        `heavy(0.2): matched=${heavyNoise.matched} distance=${heavyNoise.distance.toFixed(4)}`,
    );
    expect(lightNoise.matched).toBe(true);
  });

  it("malformed stored examples mixed into a larger set are skipped without breaking matching", () => {
    const malformed = { normalizedLandmarks: [], capturedAt: Date.now() } as PersonalizedGestureExample;
    const gestureWithMalformed: PersonalizedGesture = {
      ...openHandGesture,
      examples: [malformed, ...openHandGesture.examples],
    };
    const result = matchPersonalizedGesture(jitter(OPEN_HAND, 0.02, 99), [
      gestureWithMalformed,
      fistGesture,
      twoFingersGesture,
    ]);
    expect(result.matched).toBe(true);
    expect(result.gestureId).toBe("open-hand");
  });

  it("no enabled gestures (all disabled) yields a clean UNKNOWN", () => {
    const allDisabled = FOUR_GESTURES.map((g) => ({ ...g, enabled: false }));
    const result = matchPersonalizedGesture(OPEN_HAND, allDisabled);
    expect(result.matched).toBe(false);
    expect(result.distance).toBe(Infinity);
  });

  it("one enabled gesture among several disabled ones still matches correctly", () => {
    const mixed = FOUR_GESTURES.map((g) => (g.id === "fist" ? g : { ...g, enabled: false }));
    const result = matchPersonalizedGesture(jitter(FIST, 0.02, 99), mixed);
    expect(result.matched).toBe(true);
    expect(result.gestureId).toBe("fist");
  });

  it("multiple enabled gestures: unrelated poses are rejected across the full 5-gesture set", () => {
    const unrelatedPose: Point3D[] = OPEN_HAND.map((p) => ({ x: -p.y, y: p.x, z: p.z + 0.5 }));
    const result = matchPersonalizedGesture(unrelatedPose, FIVE_GESTURES);
    console.log(`[unrelated-pose] matched=${result.matched} distance=${result.distance.toFixed(4)}`);
    expect(result.matched).toBe(false);
  });
});
