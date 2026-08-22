/**
 * Independent, geometric template matcher for user-taught personalized
 * gestures (see types/index.ts's PersonalizedGesture, and Phase 1/2's
 * storage + recording flow). Consumes the SAME normalizedLandmarks
 * extractHandFeatures() already produces, but is otherwise a completely
 * separate layer from the built-in pipeline -- it does not call, replace,
 * or get called by RuleBasedGestureClassifier or GestureStabilizer, and
 * nothing here is wired into GESTURE_DETECTED yet. Pure logic only: no
 * chrome.*, DOM, MediaPipe, or React.
 *
 * NORMALIZATION PROPERTIES (verified directly against
 * gestureFeatures.ts's normalizeLandmarks(), not assumed):
 *   - Translation-normalized: YES -- every landmark is re-centered on the
 *     palm (mean of the four MCP joints).
 *   - Scale-normalized: YES -- divided by the wrist-to-middle-MCP distance,
 *     a hand-size reference.
 *   - Rotation-normalized: NO. There is no rotation/basis alignment step
 *     anywhere in normalizeLandmarks() -- the x/y/z axes stay in whatever
 *     orientation MediaPipe originally reported (camera/image space), just
 *     shifted and scaled. Two demonstrations of the identical hand SHAPE at
 *     different wrist rotations or camera angles will therefore have a
 *     larger raw distance than their shape similarity alone would suggest.
 *     This is a real MVP limitation (see the Phase 3 report's Known
 *     Limitations), not something silently "fixed" here by adding a new
 *     rotation-normalization algorithm -- extractHandFeatures() is
 *     deliberately left unmodified.
 */
import { isPersonalizedGestureExample } from "@/shared/personalizedGestures";
import type { Point3D } from "@/ai/gestureTypes";
import type { PersonalizedGesture } from "@/types";

const EXPECTED_LANDMARK_COUNT = 21;

/**
 * Landmark indices grouped by hand substructure (see gestureFeatures.ts's
 * documented MediaPipe topology: 0 wrist, 1-4 thumb, 5-8 index, 9-12
 * middle, 13-16 ring, 17-20 pinky). Used only for the contradiction check
 * below (see hasContradictingGroup()) -- the overall whole-hand distance
 * computation is unchanged and untouched by this grouping.
 */
type LandmarkGroupName = "wrist" | "thumb" | "index" | "middle" | "ring" | "pinky";

const LANDMARK_GROUPS: Record<LandmarkGroupName, readonly number[]> = {
  wrist: [0],
  thumb: [1, 2, 3, 4],
  index: [5, 6, 7, 8],
  middle: [9, 10, 11, 12],
  ring: [13, 14, 15, 16],
  pinky: [17, 18, 19, 20],
};

/**
 * Maximum acceptable mean per-landmark Euclidean distance (same
 * palm-centered, scale-normalized units as normalizedLandmarks) for a
 * personalized gesture to be considered a candidate at all. Kept generous
 * specifically BECAUSE rotation isn't normalized (see the file header) --
 * natural viewpoint/wrist-rotation variance between recorded examples and a
 * live frame needs headroom. This is a starting value based on that
 * reasoning, not an empirically validated one (no real-camera dataset was
 * available to tune it against) -- flagged explicitly rather than presented
 * as proven.
 */
export const MAX_ACCEPTABLE_DISTANCE = 0.35;

/**
 * Minimum confidence (see distanceToConfidence()) required to accept a
 * match. Set equal to the built-in classifier's MIN_GESTURE_CONFIDENCE
 * (see ai/gestureConstants.ts, 0.55) deliberately -- same "how confident is
 * confident enough" bar app-wide, not a coincidence and not a fresh guess.
 * That said, it was chosen by analogy: it has not been separately validated
 * against this landmark-distance-based metric specifically.
 */
export const MIN_MATCH_CONFIDENCE = 0.55;

/**
 * Minimum required gap between the best and second-best candidate
 * gestures' distances before a match is trusted. Personalized gestures can
 * have overlapping shapes (the whole reason this check exists per the
 * Phase 3 spec); a small margin means the match is genuinely ambiguous
 * between two user-taught gestures, not confidently one or the other. A
 * starting value, not empirically tuned.
 */
export const AMBIGUITY_MARGIN = 0.05;

export interface PersonalizedGestureMatchResult {
  gestureId: string | null;
  name: string | null;
  meaning: string | null;
  /** 0..1, always -- see distanceToConfidence(). 0 when nothing was
   *  comparable at all (see `distance`). */
  confidence: number;
  /** The best (lowest) mean landmark distance found across every enabled
   *  gesture's examples, REGARDLESS of whether that cleared the acceptance
   *  bar -- lets a caller distinguish "nothing to compare against"
   *  (Infinity) from "something was close but not confident enough" (a
   *  finite value here even when matched is false). */
  distance: number;
  matched: boolean;
}

const NO_MATCH: PersonalizedGestureMatchResult = {
  gestureId: null,
  name: null,
  meaning: null,
  confidence: 0,
  distance: Infinity,
  matched: false,
};

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isValidLandmarkArray(landmarks: unknown): landmarks is Point3D[] {
  if (!Array.isArray(landmarks) || landmarks.length !== EXPECTED_LANDMARK_COUNT) return false;
  return landmarks.every((point) => {
    if (typeof point !== "object" || point === null) return false;
    const p = point as Record<string, unknown>;
    return isFiniteNumber(p.x) && isFiniteNumber(p.y) && isFiniteNumber(p.z);
  });
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** Mean per-landmark Euclidean distance between two same-length,
 *  corresponding-order landmark sets -- appropriate here specifically
 *  because both sides are already translation- and scale-normalized (see
 *  the file header), so a naive corresponding-index comparison lines up
 *  the same physical joint on each side without any additional alignment
 *  step.
 *
 *  Exported (Phase 6) so personalizedGestureRotation.ts's rotation-invariant
 *  match variant can reuse this exact, already-validated distance math on
 *  rotation-normalized landmarks instead of duplicating it -- purely a
 *  visibility change, zero logic altered, so every existing caller/test is
 *  unaffected. */
export function meanLandmarkDistance(a: readonly Point3D[], b: readonly Point3D[]): number {
  const count = Math.min(a.length, b.length);
  if (count === 0) return Infinity;
  let total = 0;
  for (let i = 0; i < count; i++) {
    const dx = a[i].x - b[i].x;
    const dy = a[i].y - b[i].y;
    const dz = a[i].z - b[i].z;
    total += Math.sqrt(dx * dx + dy * dy + dz * dz);
  }
  return total / count;
}

/** Mean Euclidean distance restricted to one hand substructure's landmark
 *  indices -- same math as meanLandmarkDistance(), just over a subset. */
function groupMeanDistance(a: readonly Point3D[], b: readonly Point3D[], indices: readonly number[]): number {
  let total = 0;
  for (const i of indices) {
    const dx = a[i].x - b[i].x;
    const dy = a[i].y - b[i].y;
    const dz = a[i].z - b[i].z;
    total += Math.sqrt(dx * dx + dy * dy + dz * dz);
  }
  return total / indices.length;
}

/**
 * Per-substructure distances between two landmark sets -- exported for the
 * validation harness's diagnostics (see
 * personalizedGestureMatcher.validation.test.ts), not used by the matching
 * decision itself beyond hasContradictingGroup() below.
 */
export function computeGroupDistances(
  a: readonly Point3D[],
  b: readonly Point3D[],
): Record<LandmarkGroupName, number> {
  const result = {} as Record<LandmarkGroupName, number>;
  for (const [group, indices] of Object.entries(LANDMARK_GROUPS) as Array<[LandmarkGroupName, readonly number[]]>) {
    result[group] = groupMeanDistance(a, b, indices);
  }
  return result;
}

/**
 * How many times larger a single substructure's own distance may be than
 * the OVERALL (all 21 landmarks) distance for the same comparison before
 * it's treated as a contradiction rather than ordinary noise.
 *
 * Grounded directly in the dilution mechanism that causes the false
 * positive: if a genuine difference is concentrated in k of the 21
 * landmarks while the rest agree almost exactly, the overall mean is
 * diluted by roughly a factor of 21/k relative to that substructure's own
 * distance -- approximately 5.25x for one 4-landmark hinge finger, ~21x
 * for the single-landmark wrist, ~2.6x for a two-finger difference (8/21).
 * A ratio comfortably below the smallest of these (one hinge finger,
 * ~5.25x) reliably flags a concentrated mismatch WITHOUT depending on the
 * absolute noise scale of any particular gesture pair -- unlike a fixed
 * absolute per-group cap (which was tried first and rejected: see the
 * Phase 5 report -- the confirmed Fist/ThumbOut case's own thumb-group
 * distance sits right at MAX_ACCEPTABLE_DISTANCE's boundary, so an
 * absolute cap borrowed from that constant was unreliable, sometimes
 * missing the exact case it was meant to catch depending on noise). 3x is
 * chosen as a conservative middle point: comfortably below the ~5.25x a
 * genuine one-finger contradiction produces, comfortably above the ~1x
 * ratio ordinary, evenly-spread noise produces across all six groups
 * (verified empirically in the Phase 5 report).
 */
export const CONTRADICTION_RATIO = 3;

/**
 * A substructure's distance must ALSO clear this small absolute floor
 * before the ratio check applies -- guards against a near-exact overall
 * match (distance close to 0) producing a huge but meaningless ratio from
 * ordinary sub-noise-floor jitter in the denominator.
 */
export const MIN_CONTRADICTION_GROUP_DISTANCE = 0.05;

/**
 * True if ANY single hand substructure (the wrist, or one finger) disagrees
 * FAR more than the whole-hand average suggests it should. Root-cause fix
 * for the confirmed Fist/ThumbOut-class false positive (Phase 4): those two
 * shapes differ almost entirely in the thumb (4 of 21 landmarks), so the
 * whole-hand MEAN distance dilutes that disagreement down to a deceptively
 * small number even though one substructure is completely wrong.
 *
 * This mirrors gestureClassifier.ts's isConfidentlyOpposite()/
 * contradiction-disqualification philosophy -- a single confidently-wrong
 * part disqualifies the whole match rather than being averaged away by
 * everything else agreeing -- reimplemented here in landmark-distance space
 * (this matcher has no curl scores to reuse; it only ever sees raw
 * normalized landmarks) instead of curl-space, and using a RATIO to the
 * overall distance (see CONTRADICTION_RATIO) rather than a fixed absolute
 * cap, so it self-calibrates to whatever the actual match quality is for
 * this specific comparison instead of depending on a borrowed, differently
 * -scaled constant. No per-gesture or per-landmark special-casing: the
 * same check runs identically for every gesture and every substructure.
 *
 * Exported (Phase 6) for the same reuse reason as meanLandmarkDistance()
 * above -- visibility only, logic unchanged.
 */
export function hasContradictingGroup(
  a: readonly Point3D[],
  b: readonly Point3D[],
  overallDistance: number,
): boolean {
  for (const indices of Object.values(LANDMARK_GROUPS)) {
    const groupDistance = groupMeanDistance(a, b, indices);
    if (groupDistance >= MIN_CONTRADICTION_GROUP_DISTANCE && groupDistance > overallDistance * CONTRADICTION_RATIO) {
      return true;
    }
  }
  return false;
}

/** Linear falloff from confidence 1 at distance 0 to confidence 0 at
 *  distance === MAX_ACCEPTABLE_DISTANCE, clamped to [0, 1] beyond that
 *  range in either direction. Simple and monotonic by design -- the exact
 *  shape isn't validated against real data yet (see MAX_ACCEPTABLE_DISTANCE's
 *  own doc comment), so a more elaborate curve isn't justified over this
 *  one. */
function distanceToConfidence(distance: number): number {
  if (!Number.isFinite(distance)) return 0;
  return clamp01(1 - distance / MAX_ACCEPTABLE_DISTANCE);
}

/**
 * Compares the current frame's normalized landmarks against every ENABLED
 * personalized gesture's stored examples, and returns the single best
 * candidate if (and only if) it's both confident enough and unambiguous.
 * Never throws on malformed runtime input (invalid landmarks, a malformed
 * gesture list, malformed individual examples) -- all of it degrades to a
 * clean no-match result instead, since this runs on every detection tick
 * against live, occasionally-imperfect data.
 *
 * For each enabled gesture, its "distance" is the MINIMUM distance across
 * its own examples (gestureDistance = min(exampleDistances)) -- the best
 * single demonstration determines the match, not an average across all of
 * them. Malformed individual examples are skipped, not fatal to the whole
 * gesture. An example whose comparison has a contradicting substructure
 * (see hasContradictingGroup()) is treated as an infinite-distance
 * non-candidate, not just a high-but-possibly-winning one -- this is what
 * prevents e.g. a "Fist" query from confidently matching a stored
 * "ThumbOut" example merely because 17 of 21 landmarks happen to agree
 * (see the Phase 5 report).
 */
export function matchPersonalizedGesture(
  currentLandmarks: Point3D[] | undefined | null,
  gestures: readonly PersonalizedGesture[] | undefined | null,
): PersonalizedGestureMatchResult {
  if (!isValidLandmarkArray(currentLandmarks) || !Array.isArray(gestures)) {
    return NO_MATCH;
  }

  const candidates: Array<{ gesture: PersonalizedGesture; distance: number }> = [];

  for (const gesture of gestures) {
    if (!gesture || gesture.enabled !== true || !Array.isArray(gesture.examples)) continue;

    let bestExampleDistance = Infinity;
    for (const example of gesture.examples) {
      if (!isPersonalizedGestureExample(example)) continue;
      // A contradicting substructure disqualifies this example outright --
      // its whole-hand distance is never even considered, so it can never
      // win the min() below no matter how low the diluted average is.
      const overallDistance = meanLandmarkDistance(currentLandmarks, example.normalizedLandmarks);
      const exampleDistance = hasContradictingGroup(currentLandmarks, example.normalizedLandmarks, overallDistance)
        ? Infinity
        : overallDistance;
      if (exampleDistance < bestExampleDistance) bestExampleDistance = exampleDistance;
    }

    if (Number.isFinite(bestExampleDistance)) {
      candidates.push({ gesture, distance: bestExampleDistance });
    }
  }

  // No enabled gesture had even one usable example -- nothing was
  // comparable at all, distinct from "compared but didn't match".
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
    // Two personalized gestures are close enough to be genuinely
    // confusable for this frame -- refuse to confidently pick one rather
    // than guessing.
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
