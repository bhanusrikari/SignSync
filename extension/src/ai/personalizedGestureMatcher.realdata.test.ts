/**
 * Phase 7: real-data validation harness for the personalized gesture
 * matcher. Reads REAL, webcam-captured personalized gestures (exported
 * from chrome.storage.local via the instructions in
 * extension/real-data/README.md) and runs them through both the baseline
 * (matchPersonalizedGesture) and rotation-invariant
 * (matchPersonalizedGestureRotationInvariant) matchers, reporting rich
 * diagnostics for the Phase 7 report.
 *
 * Does NOT alter production detection behavior -- only calls the existing,
 * unmodified exported entry points from personalizedGestureMatcher.ts and
 * personalizedGestureRotation.ts. Does not touch the recording flow
 * (record.html/App.tsx/services/personalizedGestures.ts) at all.
 *
 * SKIPS CLEANLY (does not fail `npm test`) when no real-data file is
 * present -- see extension/real-data/README.md for how to produce one.
 * This is deliberate: this repository's own `npm test` must remain green
 * for anyone without a webcam/manual recording session available.
 */
import { existsSync, readFileSync } from "fs";
import { resolve } from "path";
import { describe, expect, it } from "vitest";
import {
  AMBIGUITY_MARGIN,
  MAX_ACCEPTABLE_DISTANCE,
  MIN_MATCH_CONFIDENCE,
  computeGroupDistances,
  hasContradictingGroup,
  matchPersonalizedGesture,
  meanLandmarkDistance,
} from "./personalizedGestureMatcher";
import { matchPersonalizedGestureRotationInvariant, normalizePersonalizedLandmarks } from "./personalizedGestureRotation";
import { sanitizeStoredPersonalizedGestures } from "@/shared/personalizedGestures";
import type { Point3D } from "./gestureTypes";
import type { PersonalizedGesture, PersonalizedGestureExample } from "@/types";

const REAL_DATA_PATH = resolve(__dirname, "../../real-data/personalized-gestures.json");

function loadRealData(): PersonalizedGesture[] | null {
  if (!existsSync(REAL_DATA_PATH)) return null;
  try {
    const raw = JSON.parse(readFileSync(REAL_DATA_PATH, "utf-8"));
    const gestures = sanitizeStoredPersonalizedGestures(raw);
    return gestures.length > 0 ? gestures : null;
  } catch (error) {
    console.warn(`[Phase 7] Failed to parse ${REAL_DATA_PATH}:`, error);
    return null;
  }
}

const realGestures = loadRealData();

describe("Phase 7: real-data availability", () => {
  it("reports whether a real-data export was found for this run", () => {
    if (!realGestures) {
      console.warn(
        `\n[Phase 7] NO REAL DATA FOUND at ${REAL_DATA_PATH}.\n` +
          `This test run used ZERO real MediaPipe frames -- every diagnostic below was skipped.\n` +
          `See extension/real-data/README.md for exactly how to produce this file.\n`,
      );
    } else {
      console.log(
        `[Phase 7] Loaded ${realGestures.length} real personalized gesture(s) from ${REAL_DATA_PATH}: ` +
          realGestures.map((g) => `${g.name} (${g.examples.length} examples)`).join(", "),
      );
    }
    // Always passes -- this test's only job is to make the (non-)availability
    // of real data visible in the console output, not to gate the suite.
    expect(true).toBe(true);
  });
});

type Representation = "baseline" | "rotationInvariant";

function matchWith(rep: Representation, query: Point3D[], gestures: PersonalizedGesture[]) {
  return rep === "baseline"
    ? matchPersonalizedGesture(query, gestures)
    : matchPersonalizedGestureRotationInvariant(query, gestures);
}

function prepareWith(rep: Representation, landmarks: Point3D[]): Point3D[] {
  return rep === "baseline" ? landmarks : normalizePersonalizedLandmarks(landmarks);
}

/** Removes gesture `excludeGestureId`'s example at `excludeExampleIndex` (if
 *  that's the gesture) -- used to build "everything except the example
 *  currently used as the query" for a realistic leave-one-out comparison. */
function withoutExample(
  gestures: PersonalizedGesture[],
  excludeGestureId: string,
  excludeExampleIndex: number,
): PersonalizedGesture[] {
  return gestures
    .map((g) =>
      g.id === excludeGestureId
        ? { ...g, examples: g.examples.filter((_, i) => i !== excludeExampleIndex) }
        : g,
    )
    .filter((g) => g.examples.length > 0);
}

interface FlatExample {
  gesture: PersonalizedGesture;
  example: PersonalizedGestureExample;
  index: number;
}

function flatten(gestures: PersonalizedGesture[]): FlatExample[] {
  return gestures.flatMap((gesture) => gesture.examples.map((example, index) => ({ gesture, example, index })));
}

/** Rich, per-candidate diagnostic report for one query against one gesture
 *  set -- used for the specific highlighted pairs the Phase 7 report needs
 *  (Fist<->ThumbOut etc.), not for the bulk leave-one-out sweep (too much
 *  output). Reuses the SAME exported primitives the real matcher uses
 *  internally, so these numbers are guaranteed consistent with it. */
function diagnoseCandidates(rep: Representation, queryLandmarks: Point3D[], gestures: PersonalizedGesture[]) {
  const query = prepareWith(rep, queryLandmarks);
  const candidates: Array<{
    gestureName: string;
    distance: number;
    groupDistances: Record<string, number>;
    contradicted: boolean;
  }> = [];

  for (const gesture of gestures) {
    if (!gesture.enabled) continue;
    let best: { distance: number; groupDistances: Record<string, number>; contradicted: boolean } | null = null;
    for (const example of gesture.examples) {
      const preparedExample = prepareWith(rep, example.normalizedLandmarks);
      const overall = meanLandmarkDistance(query, preparedExample);
      const contradicted = hasContradictingGroup(query, preparedExample, overall);
      const groupDistances = computeGroupDistances(query, preparedExample);
      const effective = contradicted ? Infinity : overall;
      if (!best || effective < best.distance) best = { distance: effective, groupDistances, contradicted };
    }
    if (best) candidates.push({ gestureName: gesture.name, ...best });
  }

  candidates.sort((a, b) => a.distance - b.distance);
  return candidates;
}

function logCandidateReport(label: string, candidates: ReturnType<typeof diagnoseCandidates>) {
  console.log(`  ${label}:`);
  for (const c of candidates.slice(0, 4)) {
    const groups = Object.entries(c.groupDistances)
      .map(([k, v]) => `${k}=${v.toFixed(3)}`)
      .join(" ");
    console.log(
      `    -> ${c.gestureName}: distance=${Number.isFinite(c.distance) ? c.distance.toFixed(4) : "Infinity"} ` +
        `contradicted=${c.contradicted} [${groups}]`,
    );
  }
  if (candidates.length > 1) {
    const gap = candidates[1].distance - candidates[0].distance;
    console.log(`    ambiguity gap (best - 2nd best) = ${Number.isFinite(gap) ? gap.toFixed(4) : "n/a"}`);
  }
}

describe.runIf(!!realGestures)("Phase 7: real-data validation", () => {
  // describe() bodies execute during collection regardless of runIf() --
  // only the it()s inside are actually skipped -- so this guard is what
  // actually prevents touching `realGestures` when it's null, not runIf()
  // alone.
  if (!realGestures) return;
  const gestures = realGestures;
  const items = flatten(gestures);

  for (const rep of ["baseline", "rotationInvariant"] as const) {
    describe(`representation: ${rep}`, () => {
      it("Step 5 -- genuine-match statistics (leave-one-out within each gesture)", () => {
        const genuineDistances: number[] = [];
        const genuineConfidences: number[] = [];
        let falseNegatives = 0;
        let evaluated = 0;

        for (const item of items) {
          const others = withoutExample(gestures, item.gesture.id, item.index).filter(
            (g) => g.id === item.gesture.id,
          );
          if (others.length === 0 || others[0].examples.length === 0) continue; // no other example of this gesture to compare against

          evaluated++;
          const result = matchWith(rep, item.example.normalizedLandmarks, others);
          console.log(
            `[genuine][${rep}] ${item.gesture.name}#${item.index} vs its own other examples: ` +
              `matched=${result.matched} gestureId=${result.gestureId} distance=${result.distance.toFixed(4)} ` +
              `confidence=${result.confidence.toFixed(4)}`,
          );
          if (!result.matched || result.gestureId !== item.gesture.id) {
            falseNegatives++;
            console.warn(`  ^ FALSE NEGATIVE: ${item.gesture.name}#${item.index} did not match its own gesture`);
          } else {
            genuineDistances.push(result.distance);
            genuineConfidences.push(result.confidence);
          }
        }

        if (genuineDistances.length > 0) {
          const min = Math.min(...genuineDistances);
          const max = Math.max(...genuineDistances);
          const avg = genuineDistances.reduce((a, b) => a + b, 0) / genuineDistances.length;
          const confMin = Math.min(...genuineConfidences);
          const confMax = Math.max(...genuineConfidences);
          console.log(
            `[SUMMARY][${rep}] genuine matches: n=${genuineDistances.length}/${evaluated}, ` +
              `distance min=${min.toFixed(4)} max=${max.toFixed(4)} avg=${avg.toFixed(4)}, ` +
              `confidence range=[${confMin.toFixed(4)}, ${confMax.toFixed(4)}], falseNegatives=${falseNegatives}`,
          );
        } else {
          console.log(`[SUMMARY][${rep}] no genuine-match pairs available (need >=2 examples per gesture).`);
        }

        expect(true).toBe(true);
      });

      it("Step 6 -- false-positive sweep (each example vs every OTHER gesture)", () => {
        let falsePositives = 0;
        let evaluated = 0;
        const falsePositiveDetails: string[] = [];

        for (const item of items) {
          const otherGestures = gestures.filter((g) => g.id !== item.gesture.id);
          if (otherGestures.length === 0) continue;
          evaluated++;
          const result = matchWith(rep, item.example.normalizedLandmarks, otherGestures);
          if (result.matched) {
            falsePositives++;
            const line = `${item.gesture.name}#${item.index} matched UNRELATED gesture ${result.name} (distance=${result.distance.toFixed(4)}, confidence=${result.confidence.toFixed(4)})`;
            falsePositiveDetails.push(line);
            console.warn(`[FALSE POSITIVE][${rep}] ${line}`);
          }
        }

        console.log(`[SUMMARY][${rep}] false positives: ${falsePositives}/${evaluated}`);
        if (falsePositives > 0) {
          console.warn(`[SUMMARY][${rep}] details:\n  ${falsePositiveDetails.join("\n  ")}`);
        }
        expect(true).toBe(true);
      });
    });
  }

  it("Step 6 -- highlighted pairs (Fist<->ThumbOut, OpenHand<->Fist, TwoFingers<->Point, ThumbOut<->Point)", () => {
    const byName = (needle: string) =>
      gestures.find((g) => g.name.toLowerCase().replace(/[^a-z]/g, "").includes(needle));

    const pairs: Array<[string, string]> = [
      ["fist", "thumbout"],
      ["openhand", "fist"],
      ["twofingers", "point"],
      ["thumbout", "point"],
    ];

    for (const [nameA, nameB] of pairs) {
      const gestureA = byName(nameA);
      const gestureB = byName(nameB);
      if (!gestureA || !gestureB || gestureA.examples.length === 0 || gestureB.examples.length === 0) {
        console.log(`[highlighted-pair] Skipping ${nameA} <-> ${nameB}: one or both gestures not found in real data.`);
        continue;
      }
      for (const rep of ["baseline", "rotationInvariant"] as const) {
        const aAsB = matchWith(rep, gestureA.examples[0].normalizedLandmarks, [gestureB]);
        const bAsA = matchWith(rep, gestureB.examples[0].normalizedLandmarks, [gestureA]);
        console.log(
          `[highlighted-pair][${rep}] ${gestureA.name} as ${gestureB.name}: matched=${aAsB.matched} distance=${aAsB.distance.toFixed(4)} confidence=${aAsB.confidence.toFixed(4)}`,
        );
        console.log(
          `[highlighted-pair][${rep}] ${gestureB.name} as ${gestureA.name}: matched=${bAsA.matched} distance=${bAsA.distance.toFixed(4)} confidence=${bAsA.confidence.toFixed(4)}`,
        );
        logCandidateReport(
          `${gestureA.name} candidate breakdown (rep=${rep})`,
          diagnoseCandidates(rep, gestureA.examples[0].normalizedLandmarks, [gestureA, gestureB]),
        );
      }
    }
    expect(true).toBe(true);
  });

  it("Step 7 -- ambiguity pair (looks for two similarly-named/near-duplicate gestures)", () => {
    // Prefer an explicit "...Narrow" naming convention if the user followed
    // the Phase 7 instructions; otherwise fall back to reporting the closest
    // pair of DIFFERENT gestures found in the whole dataset.
    const narrowPair = gestures.find((g) => /narrow/i.test(g.name));
    let gestureA: PersonalizedGesture | undefined;
    let gestureB: PersonalizedGesture | undefined;

    if (narrowPair) {
      const baseNamePattern = narrowPair.name.replace(/narrow/i, "").trim();
      gestureA = gestures.find((g) => g.id !== narrowPair.id && g.name.toLowerCase().includes(baseNamePattern.toLowerCase()));
      gestureB = narrowPair;
    }

    if (!gestureA || !gestureB) {
      // Fallback: find the closest cross-gesture pair in the whole dataset.
      let closest: { a: PersonalizedGesture; b: PersonalizedGesture; distance: number } | null = null;
      for (let i = 0; i < gestures.length; i++) {
        for (let j = i + 1; j < gestures.length; j++) {
          const a = gestures[i];
          const b = gestures[j];
          if (a.examples.length === 0 || b.examples.length === 0) continue;
          const d = meanLandmarkDistance(a.examples[0].normalizedLandmarks, b.examples[0].normalizedLandmarks);
          if (!closest || d < closest.distance) closest = { a, b, distance: d };
        }
      }
      if (closest) {
        gestureA = closest.a;
        gestureB = closest.b;
        console.log(
          `[ambiguity] No explicit "...Narrow" pair found -- using the closest discovered pair instead: ` +
            `${gestureA.name} <-> ${gestureB.name} (distance=${closest.distance.toFixed(4)}).`,
        );
      }
    }

    if (!gestureA || !gestureB) {
      console.log("[ambiguity] Fewer than 2 gestures with examples available -- skipping.");
      return;
    }

    for (const rep of ["baseline", "rotationInvariant"] as const) {
      const query = gestureA.examples[0].normalizedLandmarks;
      const result = matchWith(rep, query, [gestureA, gestureB]);
      console.log(
        `[ambiguity][${rep}] ${gestureA.name} query vs [${gestureA.name}, ${gestureB.name}]: matched=${result.matched} ` +
          `distance=${result.distance.toFixed(4)} confidence=${result.confidence.toFixed(4)} (AMBIGUITY_MARGIN=${AMBIGUITY_MARGIN})`,
      );
    }
    expect(true).toBe(true);
  });

  it("Step 9 -- chirality (looks for an explicit opposite-hand recording)", () => {
    const oppositeHandGesture = gestures.find((g) => /opposite.?hand/i.test(g.name));
    if (!oppositeHandGesture || oppositeHandGesture.examples.length === 0) {
      console.log(
        '[chirality] No gesture named containing "OppositeHand" found -- skipping. ' +
          "See extension/real-data/README.md if you want to test this.",
      );
      return;
    }
    const baseNamePattern = oppositeHandGesture.name.replace(/opposite.?hand/i, "").trim();
    const sameHandCounterpart = gestures.find(
      (g) => g.id !== oppositeHandGesture.id && g.name.toLowerCase().includes(baseNamePattern.toLowerCase()),
    );
    if (!sameHandCounterpart || sameHandCounterpart.examples.length === 0) {
      console.log(`[chirality] Found "${oppositeHandGesture.name}" but no matching same-hand counterpart gesture -- skipping.`);
      return;
    }

    for (const rep of ["baseline", "rotationInvariant"] as const) {
      const result = matchWith(rep, oppositeHandGesture.examples[0].normalizedLandmarks, [sameHandCounterpart]);
      console.log(
        `[chirality][${rep}] opposite-hand "${oppositeHandGesture.name}" vs same-hand "${sameHandCounterpart.name}": ` +
          `matched=${result.matched} distance=${result.distance.toFixed(4)} confidence=${result.confidence.toFixed(4)}`,
      );
    }
    expect(true).toBe(true);
  });

  it("Step E -- position/scale sanity (within-gesture spread, indirect check)", () => {
    // Direct camera-position/distance testing isn't possible from stored
    // (already translation+scale-normalized) examples alone -- but if the
    // user varied position/distance between captures as instructed, an
    // unexpectedly large within-gesture spread would show normalization
    // isn't behaving as expected. Reports the spread; does not assert a
    // pass/fail (no ground truth for what "acceptable" spread is without
    // knowing exactly what was varied).
    for (const gesture of gestures) {
      if (gesture.examples.length < 2) continue;
      const distances: number[] = [];
      for (let i = 0; i < gesture.examples.length; i++) {
        for (let j = i + 1; j < gesture.examples.length; j++) {
          distances.push(
            meanLandmarkDistance(gesture.examples[i].normalizedLandmarks, gesture.examples[j].normalizedLandmarks),
          );
        }
      }
      const max = Math.max(...distances);
      const avg = distances.reduce((a, b) => a + b, 0) / distances.length;
      console.log(
        `[position-scale-spread] ${gesture.name}: ${gesture.examples.length} examples, ` +
          `pairwise distance avg=${avg.toFixed(4)} max=${max.toFixed(4)} (MAX_ACCEPTABLE_DISTANCE=${MAX_ACCEPTABLE_DISTANCE}, MIN_MATCH_CONFIDENCE implies ~${(
            (1 - MIN_MATCH_CONFIDENCE) *
            MAX_ACCEPTABLE_DISTANCE
          ).toFixed(4)})`,
      );
    }
    expect(true).toBe(true);
  });
});
