/**
 * Phase 6 controlled comparison harness: baseline (no rotation
 * normalization) vs. Approach A (in-plane only) vs. Approach B (full 3D
 * palm-frame) -- see personalizedGestureRotation.ts for the math.
 *
 * SYNTHETIC DATA ONLY (see personalizedGestureMatcher.validation.test.ts's
 * header for the standing honesty note: no real camera/browser access in
 * this environment). This establishes mathematical rotation behavior,
 * invariance properties, numerical stability, and regression behavior --
 * it does NOT establish real MediaPipe noise characteristics, real webcam
 * perspective effects, hand-shape variation between users, occlusion
 * behavior, or real-world lighting/camera effects. See the Phase 6
 * report's "Real-world limitation" section.
 *
 * Exploratory/diagnostic (console.log-heavy); permanent regression
 * assertions for the chosen approach live in personalizedGestureRotation.test.ts.
 */
import { describe, expect, it } from "vitest";
import { matchPersonalizedGesture } from "./personalizedGestureMatcher";
import {
  matchPersonalizedGestureRotationInvariant,
  normalizeInPlaneOnly,
  normalizePersonalizedLandmarks,
} from "./personalizedGestureRotation";
import { FIST, OPEN_HAND, THUMB_OUT, buildGesture, rotateY, rotateZ } from "./personalizedGestureMatcher.fixtures";
import type { Point3D } from "./gestureTypes";

const ROTATION_ANGLES = [0, 3, 10, 20, 30, 45, 60];

function reportRow(
  label: string,
  axis: string,
  degrees: number,
  baseline: ReturnType<typeof matchPersonalizedGesture>,
  candidate: ReturnType<typeof matchPersonalizedGesture>,
): void {
  console.log(
    `[${label}] ${axis} ${degrees}deg | baseline: dist=${baseline.distance.toFixed(4)} conf=${baseline.confidence.toFixed(
      4,
    )} matched=${baseline.matched} | candidate: dist=${candidate.distance.toFixed(4)} conf=${candidate.confidence.toFixed(
      4,
    )} matched=${candidate.matched}`,
  );
}

describe("Phase 6: Step 4 -- controlled rotation comparison (Approach B, the chosen candidate)", () => {
  // Single clean example (no jitter), isolating rotation as the only variable.
  const cleanGesture = buildGesture("open-hand-clean", "OpenHand", OPEN_HAND, { jitterSeeds: [0], jitterMagnitude: 0 });

  for (const axisName of ["Z", "Y"] as const) {
    const rotateFn = axisName === "Z" ? rotateZ : rotateY;

    it(`${axisName}-axis rotation sweep: baseline vs. rotation-invariant (Approach B)`, () => {
      for (const degrees of ROTATION_ANGLES) {
        const rotated = rotateFn(OPEN_HAND, degrees);
        const baseline = matchPersonalizedGesture(rotated, [cleanGesture]);
        const candidate = matchPersonalizedGestureRotationInvariant(rotated, [cleanGesture]);
        reportRow("rotation-sweep-B", axisName, degrees, baseline, candidate);
      }
      expect(true).toBe(true);
    });
  }

  it("X-axis rotation (meaningful for a 3D synthetic hand with nonzero z-depth)", () => {
    // rotateY-equivalent about X: swap y/z roles. Local helper since the
    // shared fixtures only export Y/Z (the two axes Phase 4 actually
    // tested); X is added here specifically because Step 4 asks for it
    // "if mathematically meaningful" -- it is, since OPEN_HAND has nonzero
    // z on the thumb.
    function rotateX(landmarks: Point3D[], degrees: number): Point3D[] {
      const rad = (degrees * Math.PI) / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      return landmarks.map((p) => ({ x: p.x, y: p.y * cos - p.z * sin, z: p.y * sin + p.z * cos }));
    }

    for (const degrees of ROTATION_ANGLES) {
      const rotated = rotateX(OPEN_HAND, degrees);
      const baseline = matchPersonalizedGesture(rotated, [cleanGesture]);
      const candidate = matchPersonalizedGestureRotationInvariant(rotated, [cleanGesture]);
      reportRow("rotation-sweep-B", "X", degrees, baseline, candidate);
    }
    expect(true).toBe(true);
  });

  it("Approach A (in-plane only) for comparison: fixes Z, does NOT fix Y", () => {
    const gesture = buildGesture("open-hand-A", "OpenHand", OPEN_HAND, { jitterSeeds: [0], jitterMagnitude: 0 });
    const exampleA = normalizeInPlaneOnly(OPEN_HAND);
    const gestureA = { ...gesture, examples: [{ normalizedLandmarks: exampleA, capturedAt: Date.now() }] };

    for (const axisName of ["Z", "Y"] as const) {
      const rotateFn = axisName === "Z" ? rotateZ : rotateY;
      for (const degrees of [0, 20, 45]) {
        const rotatedQuery = normalizeInPlaneOnly(rotateFn(OPEN_HAND, degrees));
        const result = matchPersonalizedGesture(rotatedQuery, [gestureA]);
        console.log(
          `[approach-A] ${axisName} ${degrees}deg: dist=${result.distance.toFixed(4)} matched=${result.matched}`,
        );
      }
    }
    expect(true).toBe(true);
  });
});

describe("Phase 6: Step 5 -- invariance and non-collapse", () => {
  it("same gesture rotated at various angles stays close to itself (Approach B)", () => {
    const gesture = buildGesture("open-hand", "OpenHand", OPEN_HAND, { jitterSeeds: [0], jitterMagnitude: 0 });
    for (const degrees of [3, 20, 45, 60]) {
      const rotated = rotateZ(OPEN_HAND, degrees);
      const result = matchPersonalizedGestureRotationInvariant(rotated, [gesture]);
      console.log(`[invariance] OpenHand rotated ${degrees}deg vs itself: distance=${result.distance.toFixed(6)}`);
      expect(result.matched).toBe(true);
      expect(result.distance).toBeLessThan(0.01); // should be near-exact modulo floating point
    }
  });

  it("different gestures (rotated) remain separated, not collapsed together", () => {
    const openHandGesture = buildGesture("open-hand", "OpenHand", OPEN_HAND, { jitterSeeds: [0], jitterMagnitude: 0 });
    const fistGesture = buildGesture("fist", "Fist", FIST, { jitterSeeds: [0], jitterMagnitude: 0 });

    for (const degrees of [0, 20, 45]) {
      const rotatedOpenHandQuery = rotateZ(OPEN_HAND, degrees);
      const result = matchPersonalizedGestureRotationInvariant(rotatedOpenHandQuery, [fistGesture]);
      console.log(
        `[non-collapse] rotated(${degrees}deg) OpenHand vs stored Fist: distance=${result.distance.toFixed(4)} matched=${result.matched}`,
      );
      expect(result.matched).toBe(false);
    }
    void openHandGesture;
  });

  it("Fist vs ThumbOut false-positive fix remains intact under rotation normalization", () => {
    const fistGesture = buildGesture("fist", "Fist", FIST);
    const thumbOutGesture = buildGesture("thumb-out", "ThumbOut", THUMB_OUT);

    const fistAsThumbOut = matchPersonalizedGestureRotationInvariant(rotateZ(FIST, 0), [thumbOutGesture]);
    expect(fistAsThumbOut.matched).toBe(false);
    const thumbOutAsFist = matchPersonalizedGestureRotationInvariant(rotateZ(THUMB_OUT, 0), [fistGesture]);
    expect(thumbOutAsFist.matched).toBe(false);

    // Also under actual rotation, to confirm the contradiction check and
    // the rotation normalization compose correctly rather than
    // interfering with each other.
    const fistRotatedAsThumbOut = matchPersonalizedGestureRotationInvariant(rotateZ(FIST, 15), [thumbOutGesture]);
    expect(fistRotatedAsThumbOut.matched).toBe(false);
  });

  it("noise after rotation: genuine gestures remain matchable", () => {
    function jitterAfterRotate(landmarks: Point3D[], degrees: number, magnitude: number): Point3D[] {
      const rotated = rotateZ(landmarks, degrees);
      return rotated.map((p, i) => ({
        x: p.x + magnitude * Math.sin(i * 0.7),
        y: p.y + magnitude * Math.cos(i * 1.3),
        z: p.z + magnitude * Math.sin(i * 0.5),
      }));
    }

    const gesture = buildGesture("open-hand", "OpenHand", OPEN_HAND);
    const noisyRotatedQuery = jitterAfterRotate(OPEN_HAND, 15, 0.02);
    const result = matchPersonalizedGestureRotationInvariant(noisyRotatedQuery, [gesture]);
    console.log(`[noise+rotation] distance=${result.distance.toFixed(4)} matched=${result.matched}`);
    expect(result.matched).toBe(true);
  });
});

describe("Phase 6: Step 6 -- degenerate palm configurations never produce NaN/Infinity", () => {
  it("index MCP and pinky MCP coincident (zero palm-width vector)", () => {
    const degenerate = OPEN_HAND.map((p) => ({ ...p }));
    degenerate[17] = { ...degenerate[5] }; // pinky MCP := index MCP
    const result = normalizePersonalizedLandmarks(degenerate);
    expect(result.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z))).toBe(true);
  });

  it("wrist coincident with the palm center (zero up-axis vector)", () => {
    const degenerate = OPEN_HAND.map((p) => ({ ...p }));
    degenerate[0] = { x: 0, y: 0, z: 0 }; // wrist placed exactly at the (already-centered) origin
    const result = normalizePersonalizedLandmarks(degenerate);
    expect(result.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z))).toBe(true);
  });

  it("palm-width vector nearly parallel to the up-axis (near-degenerate Gram-Schmidt)", () => {
    const degenerate = OPEN_HAND.map((p) => ({ ...p }));
    // Force index/pinky MCPs onto the same line as the wrist-to-origin axis.
    degenerate[5] = { x: 0, y: -0.5, z: 0 };
    degenerate[17] = { x: 0, y: -0.6, z: 0 };
    const result = normalizePersonalizedLandmarks(degenerate);
    expect(result.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z))).toBe(true);
  });

  it("non-finite landmark coordinates never propagate into the output", () => {
    const corrupted = OPEN_HAND.map((p) => ({ ...p }));
    corrupted[10] = { x: NaN, y: Infinity, z: -Infinity };
    const result = normalizePersonalizedLandmarks(corrupted);
    expect(result.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z))).toBe(true);
  });

  it("wrong landmark count falls back gracefully rather than throwing", () => {
    expect(() => normalizePersonalizedLandmarks(OPEN_HAND.slice(0, 5))).not.toThrow();
  });

  it("matchPersonalizedGestureRotationInvariant never throws on any degenerate case above", () => {
    const gesture = buildGesture("open-hand", "OpenHand", OPEN_HAND);
    const degenerateWrist = OPEN_HAND.map((p) => ({ ...p }));
    degenerateWrist[0] = { x: 0, y: 0, z: 0 };

    expect(() => matchPersonalizedGestureRotationInvariant(degenerateWrist, [gesture])).not.toThrow();
    expect(() => matchPersonalizedGestureRotationInvariant(null, [gesture])).not.toThrow();
    expect(() => matchPersonalizedGestureRotationInvariant(OPEN_HAND, null)).not.toThrow();
  });
});
