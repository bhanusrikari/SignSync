/**
 * Phase 6: rotation-normalization investigation for the personalized
 * gesture matcher. Pure, deterministic, no chrome/DOM/MediaPipe/React.
 *
 * SCOPE: this module does NOT modify normalizeLandmarks() (gestureFeatures.ts)
 * or personalizedGestureMatcher.ts's default matchPersonalizedGesture()
 * behavior. It adds an independent, opt-in representation and a separate
 * matching entry point (matchPersonalizedGestureRotationInvariant) so the
 * existing, already-validated (Phase 3-5, 98 tests) matcher is completely
 * unaffected. Nothing here is wired into offscreen.ts, GESTURE_DETECTED, or
 * any stabilizer -- see the Phase 6 report for why, and for the
 * recommendation on what (if anything) should adopt this next.
 *
 * COORDINATE SYSTEM (verified against gestureFeatures.ts, not assumed):
 * normalizeLandmarks() already produces landmarks that are:
 *   - translation-normalized (palm-centered: origin = mean of the 4 MCP
 *     joints -- index, middle, ring, pinky)
 *   - scale-normalized (divided by the wrist-to-middle-MCP distance)
 *   - NOT rotation-normalized: translation + uniform scaling are both
 *     angle-preserving operations, so the hand's orientation exactly as
 *     MediaPipe originally reported it (in whatever direction the camera
 *     saw it) survives unchanged into normalizedLandmarks. This is
 *     precisely why a rotation-normalization step can be layered cleanly
 *     ON TOP of the existing normalizedLandmarks output (see
 *     normalizePersonalizedLandmarks() below) rather than needing to
 *     touch normalizeLandmarks() itself or redo translation/scale: since
 *     the input is already centered on the origin, rotating it about that
 *     same origin is a mathematically clean, order-independent operation
 *     that changes orientation only, without disturbing the existing
 *     translation/scale normalization at all.
 */
import { isPersonalizedGestureExample } from "@/shared/personalizedGestures";
import {
  AMBIGUITY_MARGIN,
  MAX_ACCEPTABLE_DISTANCE,
  MIN_MATCH_CONFIDENCE,
  hasContradictingGroup,
  meanLandmarkDistance,
} from "./personalizedGestureMatcher";
import type { PersonalizedGestureMatchResult } from "./personalizedGestureMatcher";
import type { Point3D } from "./gestureTypes";
import type { PersonalizedGesture } from "@/types";

const WRIST = 0;
const INDEX_MCP = 5;
const PINKY_MCP = 17;
const EXPECTED_LANDMARK_COUNT = 21;

/** Below this vector magnitude, a reference axis is treated as
 *  numerically degenerate (coincident points, or a non-finite input that
 *  propagated in) rather than a real direction. Landmarks are
 *  scale-normalized so the wrist-to-middle-MCP distance is 1 by
 *  construction -- 1e-6 is many orders of magnitude below any real hand
 *  geometry, so this only fires for genuine degeneracy, never for an
 *  unusually-shaped-but-real hand. */
const MIN_AXIS_MAGNITUDE = 1e-6;

function dot(a: Point3D, b: Point3D): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function subtract(a: Point3D, b: Point3D): Point3D {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function magnitude(v: Point3D): number {
  return Math.sqrt(dot(v, v));
}

function scale(v: Point3D, factor: number): Point3D {
  return { x: v.x * factor, y: v.y * factor, z: v.z * factor };
}

function cross(a: Point3D, b: Point3D): Point3D {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}

function isFiniteLandmarks(landmarks: readonly Point3D[]): boolean {
  return landmarks.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z));
}

/** Fallback output for a landmark set the rotation frame couldn't be
 *  (or shouldn't be) computed for -- returns the SAME landmarks, but with
 *  any non-finite coordinate replaced by 0. In the real matcher call path
 *  this never actually changes anything (the matcher only ever calls the
 *  functions below on landmarks that already passed
 *  isValidLandmarkArray()/isPersonalizedGestureExample()'s finiteness
 *  checks); it exists so this module's own guarantee -- never produce
 *  NaN/Infinity, even in a pathological direct call with corrupted input
 *  -- holds unconditionally, not just for the inputs the matcher happens
 *  to send it. */
function sanitizeToFinite(landmarks: readonly Point3D[]): Point3D[] {
  return landmarks.map((p) => ({
    x: Number.isFinite(p.x) ? p.x : 0,
    y: Number.isFinite(p.y) ? p.y : 0,
    z: Number.isFinite(p.z) ? p.z : 0,
  }));
}

/**
 * APPROACH A (evaluated, not chosen as primary -- see the Phase 6 report):
 * in-plane (Z-axis / image-plane-tilt) canonicalization only. Rotates every
 * landmark about the Z axis so the pinky-MCP -> index-MCP vector, projected
 * onto the XY plane, always points along +X. This cancels ONLY rotation
 * about the camera's Z axis (in-plane hand tilt); it does not touch the Z
 * component at all, so out-of-plane (Y/X-axis) rotation is unaffected.
 * Kept here, exported and tested, as the comparison baseline against
 * APPROACH B -- see personalizedGestureRotation.validation.test.ts.
 *
 * Falls back to the input landmarks (sanitized -- see sanitizeToFinite())
 * if the index-MCP/pinky-MCP vector's in-plane magnitude is degenerate.
 * Never throws, never produces NaN/Infinity.
 */
export function normalizeInPlaneOnly(landmarks: readonly Point3D[]): Point3D[] {
  if (landmarks.length !== EXPECTED_LANDMARK_COUNT || !isFiniteLandmarks(landmarks)) return sanitizeToFinite(landmarks);

  const indexMcp = landmarks[INDEX_MCP];
  const pinkyMcp = landmarks[PINKY_MCP];
  const vx = indexMcp.x - pinkyMcp.x;
  const vy = indexMcp.y - pinkyMcp.y;
  const mag = Math.sqrt(vx * vx + vy * vy);
  if (!(mag > MIN_AXIS_MAGNITUDE) || !Number.isFinite(mag)) return sanitizeToFinite(landmarks);

  const cos = vx / mag;
  const sin = vy / mag;
  const result = landmarks.map((p) => ({ x: p.x * cos + p.y * sin, y: -p.x * sin + p.y * cos, z: p.z }));
  return isFiniteLandmarks(result) ? result : sanitizeToFinite(landmarks);
}

/**
 * APPROACH B (chosen -- see the Phase 6 report for the comparison
 * evidence): full 3D palm-frame normalization. Builds an orthonormal
 * coordinate frame intrinsic to the hand itself (not the camera), then
 * re-expresses every landmark's position in that frame:
 *
 *   uAxis = normalize(palmCenter - wrist)         -- "up the hand"
 *   vAxisRaw = indexMCP - pinkyMCP                -- "across the palm"
 *   vAxis = normalize(vAxisRaw - (vAxisRaw . uAxis) * uAxis)  -- Gram-Schmidt,
 *                                                      forced orthogonal to uAxis
 *   wAxis = uAxis x vAxis                         -- palm-normal, unit length
 *                                                      automatically (cross
 *                                                      product of two
 *                                                      orthonormal vectors)
 *
 *   local(p) = { x: p . vAxis, y: p . uAxis, z: p . wAxis }
 *
 * Landmarks are already palm-centered (origin = palmCenter), so
 * "palmCenter - wrist" is simply -wrist in this coordinate space.
 *
 * WHY THIS IS EXACTLY ROTATION-INVARIANT (not just approximately): for any
 * proper 3D rotation R applied rigidly to every landmark (which is what a
 * wrist-rotation or camera-viewpoint change amounts to), the reference
 * vectors used to build the frame rotate the same way (uAxis -> R*uAxis,
 * vAxis -> R*vAxis), and cross products are equivariant under proper
 * rotations (R*a x R*b = R*(a x b)), so wAxis -> R*wAxis too. Since R is
 * orthogonal (R^T R = I), (R*p) . (R*axis) = p . axis for every point and
 * every axis -- the computed local coordinates are IDENTICAL regardless of
 * R. This holds for ANY rotation (Z, Y, X, or a combination), not just the
 * specific axes tested here.
 *
 * CAVEAT (documented, not fixed here -- see the Phase 6 report): this
 * assumes consistent hand chirality between compared examples. A user
 * recording examples with their right hand and later gesturing with their
 * left hand would get a mirrored frame, which this does not correct for.
 * Not addressed in this phase.
 *
 * Falls back to the input landmarks (sanitized -- see sanitizeToFinite())
 * if the wrist vector or the Gram-Schmidt-orthogonalized palm-width vector
 * is degenerate (near-zero magnitude, e.g. from coincident/corrupted
 * landmarks), or if any intermediate result is non-finite -- see Step 6 of
 * the Phase 6 report for exactly which degenerate configurations were
 * tested. Never throws, never produces NaN/Infinity.
 */
export function normalizePersonalizedLandmarks(landmarks: readonly Point3D[]): Point3D[] {
  if (landmarks.length !== EXPECTED_LANDMARK_COUNT || !isFiniteLandmarks(landmarks)) return sanitizeToFinite(landmarks);

  const wrist = landmarks[WRIST];
  // Landmarks are already palm-centered (origin = palmCenter), so the
  // vector FROM wrist TO the palm center is simply -wrist here.
  const uAxisRaw: Point3D = { x: -wrist.x, y: -wrist.y, z: -wrist.z };
  const uMag = magnitude(uAxisRaw);
  if (!(uMag > MIN_AXIS_MAGNITUDE) || !Number.isFinite(uMag)) return sanitizeToFinite(landmarks);
  const uAxis = scale(uAxisRaw, 1 / uMag);

  const vAxisRaw = subtract(landmarks[INDEX_MCP], landmarks[PINKY_MCP]);
  const vAlongU = dot(vAxisRaw, uAxis);
  const vOrtho = subtract(vAxisRaw, scale(uAxis, vAlongU));
  const vMag = magnitude(vOrtho);
  if (!(vMag > MIN_AXIS_MAGNITUDE) || !Number.isFinite(vMag)) return sanitizeToFinite(landmarks);
  const vAxis = scale(vOrtho, 1 / vMag);

  const wAxis = cross(uAxis, vAxis);

  const result = landmarks.map((p) => ({ x: dot(p, vAxis), y: dot(p, uAxis), z: dot(p, wAxis) }));
  return isFiniteLandmarks(result) ? result : sanitizeToFinite(landmarks);
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function distanceToConfidence(distance: number): number {
  if (!Number.isFinite(distance)) return 0;
  return clamp01(1 - distance / MAX_ACCEPTABLE_DISTANCE);
}

function isValidLandmarkArray(landmarks: unknown): landmarks is Point3D[] {
  if (!Array.isArray(landmarks) || landmarks.length !== EXPECTED_LANDMARK_COUNT) return false;
  return landmarks.every((point) => {
    if (typeof point !== "object" || point === null) return false;
    const p = point as Record<string, unknown>;
    return Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z);
  });
}

const NO_MATCH: PersonalizedGestureMatchResult = {
  gestureId: null,
  name: null,
  meaning: null,
  confidence: 0,
  distance: Infinity,
  matched: false,
};

/**
 * Rotation-invariant variant of matchPersonalizedGesture(), used for the
 * Phase 6 comparison/regression tests. Identical control flow (candidate
 * collection, contradiction check, distance/confidence/ambiguity gates --
 * reusing the exact same, unmodified distance/contradiction functions from
 * personalizedGestureMatcher.ts) to the existing matcher, with ONE
 * difference: both the query and every example's landmarks are passed
 * through normalizePersonalizedLandmarks() before any distance is
 * computed. NOT called from matchPersonalizedGesture() and NOT wired into
 * any live pipeline -- see the Phase 6 report for why this stays a
 * separate, opt-in entry point during this investigative phase rather than
 * becoming the new default.
 */
export function matchPersonalizedGestureRotationInvariant(
  currentLandmarks: Point3D[] | undefined | null,
  gestures: readonly PersonalizedGesture[] | undefined | null,
): PersonalizedGestureMatchResult {
  if (!isValidLandmarkArray(currentLandmarks) || !Array.isArray(gestures)) {
    return NO_MATCH;
  }

  const rotatedCurrent = normalizePersonalizedLandmarks(currentLandmarks);
  const candidates: Array<{ gesture: PersonalizedGesture; distance: number }> = [];

  for (const gesture of gestures) {
    if (!gesture || gesture.enabled !== true || !Array.isArray(gesture.examples)) continue;

    let bestExampleDistance = Infinity;
    for (const example of gesture.examples) {
      if (!isPersonalizedGestureExample(example)) continue;
      const rotatedExample = normalizePersonalizedLandmarks(example.normalizedLandmarks);
      const overallDistance = meanLandmarkDistance(rotatedCurrent, rotatedExample);
      const exampleDistance = hasContradictingGroup(rotatedCurrent, rotatedExample, overallDistance)
        ? Infinity
        : overallDistance;
      if (exampleDistance < bestExampleDistance) bestExampleDistance = exampleDistance;
    }

    if (Number.isFinite(bestExampleDistance)) {
      candidates.push({ gesture, distance: bestExampleDistance });
    }
  }

  if (candidates.length === 0) return NO_MATCH;

  candidates.sort((a, b) => a.distance - b.distance);
  const best = candidates[0];
  const secondBest = candidates[1] as { gesture: PersonalizedGesture; distance: number } | undefined;
  const confidence = distanceToConfidence(best.distance);

  if (best.distance > MAX_ACCEPTABLE_DISTANCE) {
    return { gestureId: null, name: null, meaning: null, confidence, distance: best.distance, matched: false };
  }
  if (confidence < MIN_MATCH_CONFIDENCE) {
    return { gestureId: null, name: null, meaning: null, confidence, distance: best.distance, matched: false };
  }
  if (secondBest && secondBest.distance - best.distance < AMBIGUITY_MARGIN) {
    return { gestureId: null, name: null, meaning: null, confidence, distance: best.distance, matched: false };
  }

  return {
    gestureId: best.gesture.id,
    name: best.gesture.name,
    meaning: best.gesture.meaning,
    confidence,
    distance: best.distance,
    matched: true,
  };
}
