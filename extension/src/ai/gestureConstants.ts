/**
 * Tunable thresholds for the gesture-classification pipeline. Centralized
 * here so nothing is a magic number scattered across feature extraction,
 * classification, or stabilization code.
 */

/** Curl score (0=straight..1=curled) at or below which a finger counts as
 *  confidently "extended". */
export const CURL_EXTENDED_MAX = 0.35;

/** Curl score at or above which a finger counts as confidently "curled". */
export const CURL_CURLED_MIN = 0.6;

/** Normalized tip-to-wrist / base-to-wrist distance ratio range used to map
 *  the thumb's extension onto the same 0..1 curl scale as the other
 *  fingers (the thumb bends via abduction, not a PIP hinge, so it can't use
 *  the joint-angle method the other four fingers use). */
export const THUMB_RATIO_MIN = 0.8; // fully curled/tucked
export const THUMB_RATIO_MAX = 1.6; // fully extended

/** Minimum overall template-match confidence for a classification to be
 *  reported as a known gesture rather than UNKNOWN. */
export const MIN_GESTURE_CONFIDENCE = 0.55;

/** Temporal stabilization (see gestureStabilizer.ts): rolling window +
 *  minimum-occurrence majority vote, matching TECH_SPEC.md's smoothing
 *  design (window 5, min-occurrences 3). */
export const STABILIZATION_WINDOW_SIZE = 5;
export const STABILIZATION_MIN_OCCURRENCES = 3;
