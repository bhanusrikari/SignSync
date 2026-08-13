/**
 * Shared types for the gesture-classification pipeline (landmarks ->
 * features -> classification -> stabilization). Point3D deliberately only
 * needs {x,y,z}, so this module -- and everything that consumes it -- stays
 * testable without the @mediapipe/tasks-vision package or any browser API.
 */

export interface Point3D {
  x: number;
  y: number;
  z: number;
}

/**
 * Prototype hand-shape vocabulary used to validate the classification
 * pipeline. These are NOT a formal sign language (ASL, ISL, or otherwise) --
 * just enough distinct one-handed shapes to prove landmarks -> features ->
 * classification -> stabilization end to end.
 */
export type GestureLabel = "OPEN_PALM" | "FIST" | "THUMBS_UP" | "PEACE" | "POINT" | "UNKNOWN";

export type FingerName = "thumb" | "index" | "middle" | "ring" | "pinky";

/** Per-finger curl score in [0, 1]: 0 = fully extended/straight, 1 = fully
 *  curled into the palm. Derived from joint geometry, not raw coordinates,
 *  so it stays meaningful regardless of hand position, size, or distance
 *  from the camera. */
export type FingerCurlScores = Record<FingerName, number>;

/** Normalized, hand-shape-only representation of one detected hand. */
export interface HandFeatures {
  /** Per-finger curl, 0 (straight) .. 1 (curled). What the rule-based
   *  classifier actually consumes. */
  curl: FingerCurlScores;
  /** Palm-centered, scale-normalized landmark positions (21 points).
   *  Unused by the rule-based classifier but kept here as the natural
   *  flattened-vector input a future ML classifier would want. */
  normalizedLandmarks: Point3D[];
}

export interface GestureClassificationResult {
  gesture: GestureLabel;
  /** 0..1. For UNKNOWN, this is the best (but insufficient) template match. */
  confidence: number;
}

/** Implemented by RuleBasedGestureClassifier now; a future MLClassifier can
 *  implement the same interface as a drop-in replacement -- nothing else in
 *  the pipeline needs to change. */
export interface GestureClassifier {
  classify(features: HandFeatures): GestureClassificationResult;
}

export interface StableGestureEvent {
  gesture: GestureLabel;
  confidence: number;
  timestamp: number;
}
