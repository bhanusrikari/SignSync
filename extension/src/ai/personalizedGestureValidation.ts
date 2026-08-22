/**
 * Pure validation/diagnostic logic for a user's ALREADY-SAVED personalized
 * gestures. Consumed by the "Validate My Gestures" page
 * (src/validate/App.tsx), which reads real data straight from the existing
 * services/personalizedGestures.ts storage layer -- no DevTools, no manual
 * export, no new storage code. Also directly unit-testable with synthetic
 * fixtures (see personalizedGestureValidation.test.ts).
 *
 * Reuses the exact match/distance primitives from personalizedGestureMatcher.ts
 * and personalizedGestureRotation.ts -- no duplicated distance math, and no
 * synthetic rotation is ever injected here: whatever variation exists in
 * the user's real recorded examples is all that's ever analyzed.
 *
 * No chrome/DOM API here -- this module never touches storage itself, it
 * only analyzes whatever PersonalizedGesture[] it's given.
 */
import { isPersonalizedGestureExample } from "@/shared/personalizedGestures";
import {
  MAX_ACCEPTABLE_DISTANCE,
  hasContradictingGroup,
  matchPersonalizedGesture,
  meanLandmarkDistance,
} from "./personalizedGestureMatcher";
import type { PersonalizedGestureMatchResult } from "./personalizedGestureMatcher";
import { matchPersonalizedGestureRotationInvariant, normalizePersonalizedLandmarks } from "./personalizedGestureRotation";
import { MIN_EXAMPLES, hasEnoughExamples } from "@/record/recordingValidation";
import type { Point3D } from "./gestureTypes";
import type { LanguageCode, PersonalizedGesture } from "@/types";

export type Representation = "baseline" | "rotationInvariant";

function prepare(rep: Representation, landmarks: Point3D[]): Point3D[] {
  return rep === "rotationInvariant" ? normalizePersonalizedLandmarks(landmarks) : landmarks;
}

function matchWith(rep: Representation, query: Point3D[], gestures: PersonalizedGesture[]): PersonalizedGestureMatchResult {
  return rep === "rotationInvariant"
    ? matchPersonalizedGestureRotationInvariant(query, gestures)
    : matchPersonalizedGesture(query, gestures);
}

/** Defensive re-sanitization: getPersonalizedGestures() already returns a
 *  clean list, but this module is also directly unit-tested with
 *  hand-built/malformed fixtures, so it must never assume its input was
 *  already validated. Never throws. */
function sanitizeGestures(rawGestures: unknown): PersonalizedGesture[] {
  if (!Array.isArray(rawGestures)) return [];
  const result: PersonalizedGesture[] = [];
  for (const g of rawGestures) {
    if (!g || typeof g !== "object") continue;
    const gesture = g as Partial<PersonalizedGesture>;
    if (typeof gesture.id !== "string" || typeof gesture.name !== "string" || !Array.isArray(gesture.examples)) {
      continue;
    }
    result.push({
      id: gesture.id,
      name: gesture.name,
      meaning: typeof gesture.meaning === "string" ? gesture.meaning : "",
      localizedMeanings: gesture.localizedMeanings,
      examples: gesture.examples.filter(isPersonalizedGestureExample),
      enabled: gesture.enabled !== false,
      createdAt: typeof gesture.createdAt === "number" ? gesture.createdAt : 0,
      updatedAt: typeof gesture.updatedAt === "number" ? gesture.updatedAt : 0,
    });
  }
  return result;
}

export interface RepresentationStats {
  evaluatedCount: number;
  matchedCount: number;
  minDistance: number | null;
  maxDistance: number | null;
  avgDistance: number | null;
  minConfidence: number | null;
  maxConfidence: number | null;
  /** Examples that did NOT match their own gesture against its other
   *  examples -- false negatives, the thing Step 5 asks to surface. */
  failureCount: number;
}

/** Leave-one-out same-gesture validation: each example is queried against
 *  the REST of that gesture's own examples (never against itself). Returns
 *  null when there are fewer than 2 examples -- leave-one-out is
 *  meaningless with only one. */
function computeLeaveOneOutStats(rep: Representation, gesture: PersonalizedGesture): RepresentationStats | null {
  if (gesture.examples.length < 2) return null;

  const distances: number[] = [];
  const confidences: number[] = [];
  let evaluatedCount = 0;
  let matchedCount = 0;

  gesture.examples.forEach((example, index) => {
    const others = gesture.examples.filter((_, i) => i !== index);
    if (others.length === 0) return;
    evaluatedCount++;
    const result = matchWith(rep, example.normalizedLandmarks, [{ ...gesture, examples: others }]);
    if (result.matched) {
      matchedCount++;
      distances.push(result.distance);
      confidences.push(result.confidence);
    }
  });

  return {
    evaluatedCount,
    matchedCount,
    minDistance: distances.length > 0 ? Math.min(...distances) : null,
    maxDistance: distances.length > 0 ? Math.max(...distances) : null,
    avgDistance: distances.length > 0 ? distances.reduce((a, b) => a + b, 0) / distances.length : null,
    minConfidence: confidences.length > 0 ? Math.min(...confidences) : null,
    maxConfidence: confidences.length > 0 ? Math.max(...confidences) : null,
    failureCount: evaluatedCount - matchedCount,
  };
}

/** Short, human-scannable form of a gesture id for display (e.g. "A1B2") --
 *  never used for anything but display; all real comparisons still use the
 *  full id. */
export function shortGestureId(id: string): string {
  return id.replace(/-/g, "").slice(-6).toUpperCase();
}

/**
 * Maps each gesture id to a display name that disambiguates gestures
 * sharing the exact same name (e.g. three separate recording sessions all
 * named "super") as "super #1" / "super #2" / "super #3", in list order.
 * Gestures with a unique name are left as-is. This is the fix for the
 * "super <-> super <-> super" ambiguous validator output -- see the Phase 8
 * report's Step 2/B.
 */
function computeDisplayNames(gestures: readonly PersonalizedGesture[]): Map<string, string> {
  const countByName = new Map<string, number>();
  for (const gesture of gestures) countByName.set(gesture.name, (countByName.get(gesture.name) ?? 0) + 1);

  const seenSoFar = new Map<string, number>();
  const displayNames = new Map<string, string>();
  for (const gesture of gestures) {
    if ((countByName.get(gesture.name) ?? 1) <= 1) {
      displayNames.set(gesture.id, gesture.name);
      continue;
    }
    const ordinal = (seenSoFar.get(gesture.name) ?? 0) + 1;
    seenSoFar.set(gesture.name, ordinal);
    displayNames.set(gesture.id, `${gesture.name} #${ordinal}`);
  }
  return displayNames;
}

export interface GestureValidationResult {
  gestureId: string;
  gestureName: string;
  /** Disambiguated name for display -- "super #1" when another gesture
   *  shares the name "super", otherwise identical to gestureName. */
  displayName: string;
  /** The gesture's stored meaning (Phase 10 Part 4) -- shown to ordinary
   *  users on the friendly Validate summary, distinct from `gestureName`
   *  (the sign's short label, e.g. "super" vs. meaning "Great / Excellent"). */
  meaning: string;
  /** Which languages have an authored translation (Phase 11 Part B) -- lets
   *  Validate show "Translations: Hindi, Telugu" so a user can see what's
   *  actually configured without opening Record again. Undefined/empty
   *  means only the default `meaning` (English) is available. */
  localizedMeanings?: Partial<Record<LanguageCode, string>>;
  shortId: string;
  exampleCount: number;
  enabled: boolean;
  hasEnoughExamples: boolean;
  leaveOneOut: {
    baseline: RepresentationStats | null;
    rotationInvariant: RepresentationStats | null;
  };
  /** Human-readable reason leave-one-out is null/limited, or null if full
   *  validation ran. */
  insufficientDataMessage: string | null;
}

function validateOneGesture(gesture: PersonalizedGesture, displayName: string): GestureValidationResult {
  const baseline = computeLeaveOneOutStats("baseline", gesture);
  const rotationInvariant = computeLeaveOneOutStats("rotationInvariant", gesture);

  let insufficientDataMessage: string | null = null;
  if (gesture.examples.length === 0) {
    insufficientDataMessage = "No usable examples were found for this gesture.";
  } else if (gesture.examples.length === 1) {
    insufficientDataMessage = "Only 1 example recorded -- leave-one-out validation needs at least 2 examples.";
  }

  return {
    gestureId: gesture.id,
    gestureName: gesture.name,
    displayName,
    meaning: gesture.meaning,
    localizedMeanings: gesture.localizedMeanings,
    shortId: shortGestureId(gesture.id),
    exampleCount: gesture.examples.length,
    enabled: gesture.enabled,
    hasEnoughExamples: hasEnoughExamples(gesture.examples.length),
    leaveOneOut: { baseline, rotationInvariant },
    insufficientDataMessage,
  };
}

export type RecognitionStrength = "strong" | "fair" | "weak";

/**
 * Collapses a gesture's leave-one-out validation stats into a single
 * plain-language strength rating for the friendly Validate summary (Phase
 * 10 Part 4) -- "Strong"/"Fair"/"Needs improvement" instead of raw
 * min/avg/max distances and confidence ranges. Prefers the
 * rotation-invariant representation (the one actually used for live
 * matching -- see ai/personalizedGestureRotation.ts) when available, falling
 * back to the baseline representation's stats otherwise.
 *
 * Thresholds are a presentation-layer judgment call, not a matcher
 * threshold -- MAX_ACCEPTABLE_DISTANCE/MIN_MATCH_CONFIDENCE (see
 * ai/personalizedGestureMatcher.ts) are completely unchanged and unused
 * here; this only summarizes what leave-one-out validation already found.
 */
export function summarizeRecognitionStrength(result: GestureValidationResult): RecognitionStrength {
  const stats = result.leaveOneOut.rotationInvariant ?? result.leaveOneOut.baseline;
  if (!stats || stats.evaluatedCount === 0) return "weak";
  const matchRate = stats.matchedCount / stats.evaluatedCount;
  if (matchRate >= 0.9 && (stats.minConfidence ?? 0) >= 0.7) return "strong";
  if (matchRate >= 0.6) return "fair";
  return "weak";
}

export interface CrossGesturePairResult {
  gestureAId: string;
  gestureBId: string;
  /** Disambiguated names (see computeDisplayNames()) -- e.g. "super #1" and
   *  "super #2" rather than the ambiguous raw "super" for both. */
  gestureAName: string;
  gestureBName: string;
  gestureAShortId: string;
  gestureBShortId: string;
  bestDistanceBaseline: number;
  bestDistanceRotationInvariant: number;
  /** Which example index (within each gesture, 0-based) produced the
   *  closest baseline-representation pair -- e.g. "Closest examples: #3 <->
   *  #1" in the UI. -1 when there were no examples to compare. */
  closestExampleIndexA: number;
  closestExampleIndexB: number;
  falsePositiveBaseline: boolean;
  falsePositiveRotationInvariant: boolean;
  contradictionDetected: boolean;
  flagLabel: string;
}

interface BestCrossDistanceResult {
  distance: number;
  indexA: number;
  indexB: number;
}

function bestCrossDistance(rep: Representation, a: PersonalizedGesture, b: PersonalizedGesture): BestCrossDistanceResult {
  let best: BestCrossDistanceResult = { distance: Infinity, indexA: -1, indexB: -1 };
  a.examples.forEach((exampleA, indexA) => {
    const preparedA = prepare(rep, exampleA.normalizedLandmarks);
    b.examples.forEach((exampleB, indexB) => {
      const preparedB = prepare(rep, exampleB.normalizedLandmarks);
      const distance = meanLandmarkDistance(preparedA, preparedB);
      if (distance < best.distance) best = { distance, indexA, indexB };
    });
  });
  return best;
}

/** True if any example of `a` confidently matches `b` alone (or vice
 *  versa) -- mirrors the "single-candidate" scenario (no second gesture
 *  present to trigger the ambiguity check), the case that actually matters
 *  for catching a real confusable pair. */
function anyFalsePositive(rep: Representation, a: PersonalizedGesture, b: PersonalizedGesture): boolean {
  for (const example of a.examples) {
    if (matchWith(rep, example.normalizedLandmarks, [b]).matched) return true;
  }
  for (const example of b.examples) {
    if (matchWith(rep, example.normalizedLandmarks, [a]).matched) return true;
  }
  return false;
}

function anyContradiction(a: PersonalizedGesture, b: PersonalizedGesture): boolean {
  for (const exampleA of a.examples) {
    for (const exampleB of b.examples) {
      const overall = meanLandmarkDistance(exampleA.normalizedLandmarks, exampleB.normalizedLandmarks);
      if (hasContradictingGroup(exampleA.normalizedLandmarks, exampleB.normalizedLandmarks, overall)) return true;
    }
  }
  return false;
}

/** Known confusable-by-name pairs worth calling out explicitly even when
 *  they turn out fine -- Step 3's specific ask. Matched loosely
 *  (lowercased, non-letters stripped) so "Thumb Out", "thumb-out", and
 *  "ThumbOut" all match the same way. */
const HIGHLIGHT_PAIRS: Array<[string, string, string]> = [
  ["fist", "thumbout", "Known confusable pair (Fist / ThumbOut differ only in the thumb)"],
  ["openhand", "openhandnarrow", "Near-duplicate names (OpenHand / OpenHandNarrow)"],
];

function simplifyName(name: string): string {
  return name.toLowerCase().replace(/[^a-z]/g, "");
}

function findHighlightLabel(nameA: string, nameB: string): string | null {
  const a = simplifyName(nameA);
  const b = simplifyName(nameB);
  for (const [needleA, needleB, label] of HIGHLIGHT_PAIRS) {
    if ((a.includes(needleA) && b.includes(needleB)) || (a.includes(needleB) && b.includes(needleA))) {
      return label;
    }
  }
  return null;
}

/** Every gesture pair, but only the ones worth showing: explicitly
 *  highlighted named pairs (always shown, even if they turn out fine),
 *  pairs with a detected false positive, or pairs whose closest examples
 *  fall under MAX_ACCEPTABLE_DISTANCE (the matcher's own "could plausibly
 *  be confused" bar) -- reused directly rather than a new arbitrary
 *  threshold. Sorted closest-first.
 *
 *  A pair of gesture RECORDS that share the exact same name (e.g. three
 *  separate recording sessions all named "super") is always flagged too --
 *  identical names are themselves worth surfacing distinctly (via
 *  displayNames' "#1"/"#2" suffixes) since they likely represent the same
 *  intended gesture stored as multiple separate records rather than one
 *  record with multiple examples (see the Phase 8 report). */
function validateCrossGesture(
  gestures: PersonalizedGesture[],
  displayNames: Map<string, string>,
): CrossGesturePairResult[] {
  const pairs: CrossGesturePairResult[] = [];

  for (let i = 0; i < gestures.length; i++) {
    for (let j = i + 1; j < gestures.length; j++) {
      const a = gestures[i];
      const b = gestures[j];
      if (a.examples.length === 0 || b.examples.length === 0) continue;

      const bestBaseline = bestCrossDistance("baseline", a, b);
      const bestRotationInvariant = bestCrossDistance("rotationInvariant", a, b);
      const falsePositiveBaseline = anyFalsePositive("baseline", a, b);
      const falsePositiveRotationInvariant = anyFalsePositive("rotationInvariant", a, b);
      const contradictionDetected = anyContradiction(a, b);
      const explicitLabel = findHighlightLabel(a.name, b.name);
      const sameName = a.name === b.name;
      const suspicious =
        bestBaseline.distance < MAX_ACCEPTABLE_DISTANCE || bestRotationInvariant.distance < MAX_ACCEPTABLE_DISTANCE;

      if (!explicitLabel && !sameName && !suspicious && !falsePositiveBaseline && !falsePositiveRotationInvariant) {
        continue;
      }

      pairs.push({
        gestureAId: a.id,
        gestureBId: b.id,
        gestureAName: displayNames.get(a.id) ?? a.name,
        gestureBName: displayNames.get(b.id) ?? b.name,
        gestureAShortId: shortGestureId(a.id),
        gestureBShortId: shortGestureId(b.id),
        bestDistanceBaseline: bestBaseline.distance,
        bestDistanceRotationInvariant: bestRotationInvariant.distance,
        closestExampleIndexA: bestBaseline.indexA,
        closestExampleIndexB: bestBaseline.indexB,
        falsePositiveBaseline,
        falsePositiveRotationInvariant,
        contradictionDetected,
        flagLabel:
          explicitLabel ??
          (sameName
            ? "Duplicate name -- likely the same intended gesture recorded as separate records"
            : falsePositiveBaseline || falsePositiveRotationInvariant
              ? "Possible false positive"
              : "Suspiciously close"),
      });
    }
  }

  return pairs.sort((a, b) => a.bestDistanceBaseline - b.bestDistanceBaseline);
}

export interface PersonalizedGestureValidationReport {
  gestureCount: number;
  gestures: GestureValidationResult[];
  crossGesturePairs: CrossGesturePairResult[];
  summary: string;
}

/**
 * Top-level entry point: analyzes whatever personalized gestures are
 * passed in (normally the direct result of
 * services/personalizedGestures.ts's getPersonalizedGestures()) and
 * returns a complete, human-readable report. Never throws -- 0 gestures, 1
 * gesture, gestures with 0/1 examples, and malformed input are all handled
 * gracefully (see sanitizeGestures() and the per-gesture/per-pair null
 * checks above).
 */
export function validatePersonalizedGestures(rawGestures: unknown): PersonalizedGestureValidationReport {
  const gestures = sanitizeGestures(rawGestures);

  if (gestures.length === 0) {
    return {
      gestureCount: 0,
      gestures: [],
      crossGesturePairs: [],
      summary: "No personalized gestures have been recorded yet. Record at least one gesture to see validation results.",
    };
  }

  const displayNames = computeDisplayNames(gestures);
  const gestureResults = gestures.map((gesture) => validateOneGesture(gesture, displayNames.get(gesture.id) ?? gesture.name));
  const crossGesturePairs = gestures.length >= 2 ? validateCrossGesture(gestures, displayNames) : [];

  const summaryParts: string[] = [`${gestures.length} personalized gesture${gestures.length === 1 ? "" : "s"} recorded.`];

  if (gestures.length === 1) {
    summaryParts.push(
      "Cross-gesture false-positive comparison is limited to a single gesture -- record a second gesture for a meaningful comparison.",
    );
  }

  const duplicateNameCount = new Set(
    gestures.filter((g, i) => gestures.some((other, j) => j !== i && other.name === g.name)).map((g) => g.name),
  ).size;
  if (duplicateNameCount > 0) {
    summaryParts.push(
      `${duplicateNameCount} name${duplicateNameCount === 1 ? " is" : "s are"} used by more than one gesture record ` +
        `(shown as "#1"/"#2" below) -- likely separate recording sessions of the same intended gesture, not one gesture with many examples.`,
    );
  }

  const needMoreExamples = gestureResults.filter((g) => !g.hasEnoughExamples);
  if (needMoreExamples.length > 0) {
    summaryParts.push(
      `${needMoreExamples.length} gesture${needMoreExamples.length === 1 ? " has" : "s have"} fewer than ${MIN_EXAMPLES} examples.`,
    );
  }

  const flaggedPairs = crossGesturePairs.filter((p) => p.falsePositiveBaseline || p.falsePositiveRotationInvariant);
  if (flaggedPairs.length > 0) {
    summaryParts.push(`${flaggedPairs.length} pair(s) showed a possible false positive.`);
  } else if (crossGesturePairs.length > 0 || gestures.length >= 2) {
    summaryParts.push("No false positives detected among recorded gestures.");
  }

  return {
    gestureCount: gestures.length,
    gestures: gestureResults,
    crossGesturePairs,
    summary: summaryParts.join(" "),
  };
}
