/**
 * Deterministic, explainable gesture classifier (first version of the
 * gesture-classification pipeline -- a trained ML model is intentionally
 * out of scope for this branch). A future ML-based classifier can implement
 * the same `GestureClassifier` interface as a drop-in replacement; nothing
 * else in the pipeline needs to change.
 *
 * Single-hand only: callers are expected to pass features extracted from
 * one hand's landmarks (the first detected hand -- see offscreen.ts).
 */
import { CURL_CURLED_MIN, CURL_EXTENDED_MAX, MIN_GESTURE_CONFIDENCE } from "./gestureConstants";
import { isCurled, isExtended } from "./gestureFeatures";
import type {
  FingerCurlScores,
  FingerName,
  GestureClassificationResult,
  GestureClassifier,
  GestureLabel,
  HandFeatures,
} from "./gestureTypes";

type FingerExpectation = "extended" | "curled" | "any";
type GestureTemplate = Record<FingerName, FingerExpectation>;

/**
 * Prototype hand-shape vocabulary. These are NOT a formal sign language
 * (ASL, ISL, or otherwise) -- just distinct hand shapes to validate the
 * landmarks -> features -> classification -> stabilization pipeline.
 * Thumb is "any" for PEACE since real-world peace signs vary in thumb
 * position (tucked, resting on the curled fingers, etc.).
 */
const GESTURE_TEMPLATES: Record<Exclude<GestureLabel, "UNKNOWN">, GestureTemplate> = {
  FIST: { thumb: "curled", index: "curled", middle: "curled", ring: "curled", pinky: "curled" },
  OPEN_PALM: { thumb: "extended", index: "extended", middle: "extended", ring: "extended", pinky: "extended" },
  THUMBS_UP: { thumb: "extended", index: "curled", middle: "curled", ring: "curled", pinky: "curled" },
  PEACE: { thumb: "any", index: "extended", middle: "extended", ring: "curled", pinky: "curled" },
  POINT: { thumb: "curled", index: "extended", middle: "curled", ring: "curled", pinky: "curled" },
};

/** How well one finger's curl score matches an expected state, in [0, 1].
 *  "any" always matches fully so it doesn't affect the gesture's score. */
function fingerMatchScore(curlScore: number, expected: FingerExpectation): number {
  if (expected === "any") return 1;
  if (expected === "extended") {
    return Math.min(1, Math.max(0, 1 - curlScore / CURL_EXTENDED_MAX));
  }
  return Math.min(1, Math.max(0, (curlScore - CURL_CURLED_MIN) / (1 - CURL_CURLED_MIN)));
}

/** True if `curlScore` is confidently the OPPOSITE of `expected` -- e.g. a
 *  finger expected "extended" that's actually confidently curled. Reuses
 *  isExtended()/isCurled() (and thus the same centralized CURL_EXTENDED_MAX/
 *  CURL_CURLED_MIN thresholds fingerMatchScore() already uses) -- no new or
 *  duplicated thresholds. Merely ambiguous (dead-zone) curl scores are
 *  neither confidently extended nor confidently curled, so this returns
 *  false for them -- only a confidently-opposite finger counts. */
function isConfidentlyOpposite(curlScore: number, expected: FingerExpectation): boolean {
  if (expected === "extended") return isCurled(curlScore);
  if (expected === "curled") return isExtended(curlScore);
  return false; // "any" can never be contradicted
}

function templateMatchScore(curl: FingerCurlScores, template: GestureTemplate): number {
  const relevantFingers = (Object.keys(template) as FingerName[]).filter(
    (finger) => template[finger] !== "any",
  );
  if (relevantFingers.length === 0) return 0;

  // A finger confidently in the opposite state disqualifies the whole
  // template immediately, rather than being diluted into the average by
  // the other fingers -- see gesture-robustness review.
  const hasContradiction = relevantFingers.some((finger) =>
    isConfidentlyOpposite(curl[finger], template[finger]),
  );
  if (hasContradiction) return 0;

  const total = relevantFingers.reduce(
    (sum, finger) => sum + fingerMatchScore(curl[finger], template[finger]),
    0,
  );
  return total / relevantFingers.length;
}

export class RuleBasedGestureClassifier implements GestureClassifier {
  classify(features: HandFeatures): GestureClassificationResult {
    let bestGesture: GestureLabel = "UNKNOWN";
    let bestScore = 0;

    for (const [gesture, template] of Object.entries(GESTURE_TEMPLATES) as Array<
      [Exclude<GestureLabel, "UNKNOWN">, GestureTemplate]
    >) {
      const score = templateMatchScore(features.curl, template);
      if (score > bestScore) {
        bestScore = score;
        bestGesture = gesture;
      }
    }

    if (bestScore < MIN_GESTURE_CONFIDENCE) {
      return { gesture: "UNKNOWN", confidence: bestScore };
    }
    return { gesture: bestGesture, confidence: bestScore };
  }
}
