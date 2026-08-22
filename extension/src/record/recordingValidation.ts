/**
 * Pure logic for the gesture-recording page (see App.tsx): capture
 * readiness/quality checks, duplicate-capture guarding, the minimum-example
 * gate, and form validation. No MediaPipe/DOM/chrome API here -- testable
 * with plain landmark fixtures, consistent with ai/gestureFeatures.ts and
 * shared/personalizedGestures.ts.
 */
import { t } from "@/i18n";
import type { LanguageCode, PersonalizedGestureExample } from "@/types";
import type { Point3D } from "@/ai/gestureTypes";

/** MediaPipe's HandLandmarker is configured with numHands: 1 (see
 *  ai/handTracker.ts, not modified here), so "multiple hands" should never
 *  actually occur -- kept as an explicit, testable branch anyway rather
 *  than assuming that configuration never changes. */
const EXPECTED_LANDMARK_COUNT = 21;

/** Minimum examples required before Save is allowed. Matches the 5-10
 *  guidance from the personalized-gestures architecture investigation. */
export const MIN_EXAMPLES = 5;

/** Recommended upper bound shown to the user as a natural stopping point --
 *  NOT enforced as a hard cap; capturing more is harmless. */
export const RECOMMENDED_MAX_EXAMPLES = 10;

export type CaptureReadiness =
  | { ready: true }
  | { ready: false; reason: "no_hand" | "multiple_hands" | "wrong_landmark_count" | "non_finite_landmarks" };

function isFiniteNumber(value: number): boolean {
  return Number.isFinite(value);
}

function hasFiniteCoordinates(landmarks: Point3D[]): boolean {
  return landmarks.every((point) => isFiniteNumber(point.x) && isFiniteNumber(point.y) && isFiniteNumber(point.z));
}

/**
 * Whether the currently detected hand is a valid capture candidate. Mirrors
 * extractHandFeatures()'s own 21-landmark expectation without calling it,
 * so the page can show a specific status message before ever invoking
 * extraction, and this never throws (extractHandFeatures() does, by
 * design, for exactly this malformed-input case).
 */
export function checkCaptureReadiness(
  handsDetected: number,
  landmarks: Point3D[] | undefined,
): CaptureReadiness {
  if (handsDetected === 0 || !landmarks) return { ready: false, reason: "no_hand" };
  if (handsDetected > 1) return { ready: false, reason: "multiple_hands" };
  if (landmarks.length !== EXPECTED_LANDMARK_COUNT) return { ready: false, reason: "wrong_landmark_count" };
  if (!hasFiniteCoordinates(landmarks)) return { ready: false, reason: "non_finite_landmarks" };
  return { ready: true };
}

/** User-facing status text for the current readiness state. */
export function describeReadiness(readiness: CaptureReadiness): string {
  if (readiness.ready) return "Hand detected — ready to capture";
  switch (readiness.reason) {
    case "no_hand":
      return "No hand detected";
    case "multiple_hands":
      return "Multiple hands detected — show only one hand";
    case "wrong_landmark_count":
    case "non_finite_landmarks":
      return "Hand tracking lost — try repositioning your hand";
  }
}

/** Mean per-landmark Euclidean distance between two same-length landmark
 *  sets, in the same palm-centered/scale-normalized units
 *  extractHandFeatures() already produces (see ai/gestureFeatures.ts). */
function meanLandmarkDistance(a: Point3D[], b: Point3D[]): number {
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

/** Below this mean per-landmark distance, two captures are treated as the
 *  same frozen pose rather than two genuine demonstrations. Landmarks are
 *  normalized to roughly hand-sized units (see normalizeLandmarks() in
 *  gestureFeatures.ts), so 0.02 is a small fraction of that scale --
 *  deliberately tight, meant only to catch a literal duplicate capture
 *  (e.g. an accidental double-click), not to reject the natural pose
 *  variation between separate demonstrations. A starting heuristic, not an
 *  empirically tuned constant. */
const DUPLICATE_DISTANCE_THRESHOLD = 0.02;

/**
 * True if `candidate` is a near-duplicate of the MOST RECENTLY captured
 * example. Deliberately compares against only the last example (not every
 * prior one) to stay a cheap, simple guard rather than a clustering
 * algorithm, per the recording-flow requirements.
 */
export function isNearDuplicateOfLast(
  candidate: Point3D[],
  examples: readonly PersonalizedGestureExample[],
): boolean {
  const last = examples[examples.length - 1];
  if (!last) return false;
  return meanLandmarkDistance(candidate, last.normalizedLandmarks) < DUPLICATE_DISTANCE_THRESHOLD;
}

export function hasEnoughExamples(count: number): boolean {
  return count >= MIN_EXAMPLES;
}

/** null means valid; otherwise a user-facing, localized validation message
 *  (Phase 11 Part F -- previously always hardcoded English regardless of
 *  the interface language). */
export function validateGestureName(name: string, language: LanguageCode): string | null {
  return name.trim().length === 0 ? t("record.validation.nameRequired", language) : null;
}

/** null means valid; otherwise a user-facing, localized validation message
 *  (Phase 11 Part F). */
export function validateGestureMeaning(meaning: string, language: LanguageCode): string | null {
  return meaning.trim().length === 0 ? t("record.validation.meaningRequired", language) : null;
}

/**
 * Prepares the Record page's multilingual-meaning form drafts (Phase 10.1
 * Part 2) for saving: trims every value, drops languages left blank
 * entirely. Never persists an empty-string translation -- that would defeat
 * getLocalizedMeaning()'s "falls back to the English meaning" guarantee
 * (see shared/personalizedGestures.ts) by making a language look like it
 * HAS a translation when the user actually left it empty. Returns
 * `undefined` (not `{}`) when nothing was translated at all, matching
 * PersonalizedGesture.localizedMeanings' own "entirely optional" contract.
 */
export function cleanLocalizedMeanings(
  drafts: Partial<Record<LanguageCode, string>>,
): Partial<Record<LanguageCode, string>> | undefined {
  const entries = Object.entries(drafts).filter(
    (entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].trim().length > 0,
  );
  if (entries.length === 0) return undefined;
  return Object.fromEntries(entries.map(([code, value]) => [code, value.trim()]));
}
