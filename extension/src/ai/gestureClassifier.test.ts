/**
 * Regression tests for RuleBasedGestureClassifier. Pure function/class
 * under test -- no MediaPipe, camera, Chrome APIs, or the offscreen
 * document involved. Fixtures are hand-built FingerCurlScores, exercised
 * only through the classifier's public classify() method (never the
 * private templateMatchScore()), so these test behavior, not internals.
 */
import { describe, expect, it } from "vitest";
import { RuleBasedGestureClassifier } from "./gestureClassifier";
import { CURL_CURLED_MIN, CURL_EXTENDED_MAX, MIN_GESTURE_CONFIDENCE } from "./gestureConstants";
import type { FingerCurlScores, HandFeatures } from "./gestureTypes";

const EXTENDED = 0; // fully straight finger
const CURLED = 1; // fully curled finger
// Halfway between the two thresholds: neither confidently extended nor
// confidently curled. Derived from the real constants rather than a
// hardcoded number, so this stays correct if the thresholds are ever retuned.
const DEAD_ZONE = (CURL_EXTENDED_MAX + CURL_CURLED_MIN) / 2;

function makeFeatures(curl: FingerCurlScores): HandFeatures {
  return { curl, normalizedLandmarks: [] }; // classifier never reads normalizedLandmarks
}

const classifier = new RuleBasedGestureClassifier();

describe("RuleBasedGestureClassifier", () => {
  it("does not let PEACE win when one relevant finger is confidently the opposite state (regression for a1bcb6a)", () => {
    // index/middle/ring perfectly match PEACE (ext, ext, curl); pinky is
    // confidently EXTENDED even though PEACE requires it curled. Before the
    // a1bcb6a fix, this diluted into a 0.75-confidence "PEACE" (3 perfect
    // fingers averaged with 1 zero-scoring finger). It must not anymore.
    const features = makeFeatures({
      thumb: CURLED, // irrelevant -- PEACE's thumb expectation is "any"
      index: EXTENDED,
      middle: EXTENDED,
      ring: CURLED,
      pinky: EXTENDED, // contradicts PEACE's "curled" expectation
    });

    const result = classifier.classify(features);

    expect(result.gesture).not.toBe("PEACE");
    expect(result.confidence).toBeLessThan(MIN_GESTURE_CONFIDENCE);
  });

  it("does not disqualify a template just because one relevant finger is ambiguous (dead zone)", () => {
    // Four fingers perfectly match FIST; pinky sits exactly between the two
    // thresholds -- ambiguous, not confidently opposite. FIST must still be
    // able to win: dead-zone fingers are diluted into the average (as
    // before), not treated as a disqualifying contradiction.
    const features = makeFeatures({
      thumb: CURLED,
      index: CURLED,
      middle: CURLED,
      ring: CURLED,
      pinky: DEAD_ZONE,
    });

    const result = classifier.classify(features);

    expect(result.gesture).toBe("FIST");
    expect(result.confidence).toBeGreaterThanOrEqual(MIN_GESTURE_CONFIDENCE);
  });

  it("classifies a clean OPEN_PALM (all fingers extended)", () => {
    const result = classifier.classify(
      makeFeatures({ thumb: EXTENDED, index: EXTENDED, middle: EXTENDED, ring: EXTENDED, pinky: EXTENDED }),
    );

    expect(result.gesture).toBe("OPEN_PALM");
    expect(result.confidence).toBeGreaterThanOrEqual(MIN_GESTURE_CONFIDENCE);
  });

  it("classifies a clean FIST (all fingers curled)", () => {
    const result = classifier.classify(
      makeFeatures({ thumb: CURLED, index: CURLED, middle: CURLED, ring: CURLED, pinky: CURLED }),
    );

    expect(result.gesture).toBe("FIST");
    expect(result.confidence).toBeGreaterThanOrEqual(MIN_GESTURE_CONFIDENCE);
  });

  it("classifies a clean THUMBS_UP (thumb extended, others curled)", () => {
    const result = classifier.classify(
      makeFeatures({ thumb: EXTENDED, index: CURLED, middle: CURLED, ring: CURLED, pinky: CURLED }),
    );

    expect(result.gesture).toBe("THUMBS_UP");
    expect(result.confidence).toBeGreaterThanOrEqual(MIN_GESTURE_CONFIDENCE);
  });

  it("classifies a clean PEACE (index+middle extended, ring+pinky curled)", () => {
    const result = classifier.classify(
      makeFeatures({ thumb: CURLED, index: EXTENDED, middle: EXTENDED, ring: CURLED, pinky: CURLED }),
    );

    expect(result.gesture).toBe("PEACE");
    expect(result.confidence).toBeGreaterThanOrEqual(MIN_GESTURE_CONFIDENCE);
  });

  it("classifies a clean POINT (only index extended)", () => {
    const result = classifier.classify(
      makeFeatures({ thumb: CURLED, index: EXTENDED, middle: CURLED, ring: CURLED, pinky: CURLED }),
    );

    expect(result.gesture).toBe("POINT");
    expect(result.confidence).toBeGreaterThanOrEqual(MIN_GESTURE_CONFIDENCE);
  });
});
