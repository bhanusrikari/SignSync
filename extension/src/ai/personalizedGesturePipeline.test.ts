/**
 * Phase 9.3: end-to-end verification of the REAL pipeline a live frame and
 * a recorded example both actually go through -- extractHandFeatures()
 * (gestureFeatures.ts, translation + scale normalization) feeding
 * matchPersonalizedGestureRotationInvariant() (rotation normalization +
 * distance/confidence/threshold decision) -- using a synthetic dataset
 * sized like the real reported "super" gesture (54 examples) rather than
 * the smaller ad-hoc fixtures used elsewhere.
 *
 * Deliberately starts from RAW, un-normalized, camera-space-like landmarks
 * (arbitrary position, scale, and orientation) and runs them through
 * extractHandFeatures() itself -- exactly what offscreen.ts's detection
 * tick and record/App.tsx's capture flow both do -- rather than starting
 * from already-normalized fixtures. This is what actually proves "a live
 * frame recorded at a different distance/position/angle from the camera
 * than the original recording still matches its own gesture," not merely
 * "already-normalized vectors that happen to be close together."
 *
 * gestureFeatures.ts, personalizedGestureMatcher.ts, and
 * personalizedGestureRotation.ts are all used completely unmodified here --
 * no thresholds, no algorithm changes.
 */
import { describe, expect, it } from "vitest";
import { extractHandFeatures } from "./gestureFeatures";
import { matchPersonalizedGestureRotationInvariant } from "./personalizedGestureRotation";
import { AMBIGUITY_MARGIN, MAX_ACCEPTABLE_DISTANCE, MIN_MATCH_CONFIDENCE } from "./personalizedGestureMatcher";
import type { Point3D } from "./gestureTypes";
import type { PersonalizedGesture, PersonalizedGestureExample } from "@/types";

/** A plausible raw hand shape in arbitrary camera-space units (NOT
 *  pre-normalized) -- structurally the same "open hand, fingers spread"
 *  shape used elsewhere in this test suite, but expressed the way MediaPipe
 *  would actually report it: an arbitrary position far from the origin, at
 *  an arbitrary scale, not axis-aligned. */
const RAW_OPEN_HAND: Point3D[] = [
  { x: 0.52, y: 0.61, z: -0.02 }, // 0 wrist
  { x: 0.47, y: 0.57, z: 0.0 }, // 1 thumb CMC
  { x: 0.44, y: 0.53, z: 0.02 }, // 2 thumb MCP
  { x: 0.41, y: 0.49, z: 0.04 }, // 3 thumb IP
  { x: 0.38, y: 0.45, z: 0.05 }, // 4 thumb TIP
  { x: 0.49, y: 0.55, z: 0.0 }, // 5 index MCP
  { x: 0.485, y: 0.47, z: 0.0 }, // 6 index PIP
  { x: 0.48, y: 0.41, z: 0.0 }, // 7 index DIP
  { x: 0.475, y: 0.36, z: 0.0 }, // 8 index TIP
  { x: 0.52, y: 0.545, z: 0.0 }, // 9 middle MCP
  { x: 0.52, y: 0.455, z: 0.0 }, // 10 middle PIP
  { x: 0.52, y: 0.39, z: 0.0 }, // 11 middle DIP
  { x: 0.52, y: 0.335, z: 0.0 }, // 12 middle TIP
  { x: 0.555, y: 0.545, z: 0.0 }, // 13 ring MCP
  { x: 0.56, y: 0.465, z: 0.0 }, // 14 ring PIP
  { x: 0.565, y: 0.41, z: 0.0 }, // 15 ring DIP
  { x: 0.57, y: 0.365, z: 0.0 }, // 16 ring TIP
  { x: 0.585, y: 0.54, z: 0.0 }, // 17 pinky MCP
  { x: 0.595, y: 0.475, z: 0.0 }, // 18 pinky PIP
  { x: 0.6, y: 0.435, z: 0.0 }, // 19 pinky DIP
  { x: 0.605, y: 0.4, z: 0.0 }, // 20 pinky TIP
];

function translate(landmarks: Point3D[], dx: number, dy: number, dz: number): Point3D[] {
  return landmarks.map((p) => ({ x: p.x + dx, y: p.y + dy, z: p.z + dz }));
}

function scaleAbout(landmarks: Point3D[], factor: number, origin: Point3D): Point3D[] {
  return landmarks.map((p) => ({
    x: origin.x + (p.x - origin.x) * factor,
    y: origin.y + (p.y - origin.y) * factor,
    z: origin.z + (p.z - origin.z) * factor,
  }));
}

function rotateAboutZ(landmarks: Point3D[], degrees: number, origin: Point3D): Point3D[] {
  const rad = (degrees * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return landmarks.map((p) => {
    const x = p.x - origin.x;
    const y = p.y - origin.y;
    return { x: origin.x + x * cos - y * sin, y: origin.y + x * sin + y * cos, z: p.z };
  });
}

/** RAW_OPEN_HAND's own wrist-to-middle-MCP distance -- the scale reference
 *  extractHandFeatures()/normalizeLandmarks() divides by. Raw jitter
 *  magnitudes below are expressed as a fraction of THIS (not a fixed
 *  absolute number), so they land at a comparable, realistic magnitude in
 *  NORMALIZED space regardless of what units this fixture's raw coordinates
 *  happen to be drawn in -- an absolute raw magnitude tuned for one fixture
 *  scale silently becomes wildly too large (or too small) for a
 *  differently-scaled one. */
const RAW_SCALE = Math.hypot(
  RAW_OPEN_HAND[0].x - RAW_OPEN_HAND[9].x,
  RAW_OPEN_HAND[0].y - RAW_OPEN_HAND[9].y,
  RAW_OPEN_HAND[0].z - RAW_OPEN_HAND[9].z,
);

/** Deterministic small per-landmark jitter simulating natural hand
 *  micro-movement / camera noise between separate recordings. `magnitude`
 *  is a FRACTION of RAW_SCALE (e.g. 0.02 = 2% of the hand's own size),
 *  not an absolute raw-coordinate value -- see RAW_SCALE's doc comment. */
function jitterRaw(landmarks: Point3D[], magnitudeFraction: number, seed: number): Point3D[] {
  const magnitude = magnitudeFraction * RAW_SCALE;
  return landmarks.map((p, i) => ({
    x: p.x + magnitude * Math.sin(seed + i * 0.7),
    y: p.y + magnitude * Math.cos(seed + i * 1.3),
    z: p.z + magnitude * Math.sin(seed * 1.1 + i * 0.5),
  }));
}

function toExample(rawLandmarks: Point3D[]): PersonalizedGestureExample {
  return { normalizedLandmarks: extractHandFeatures(rawLandmarks).normalizedLandmarks, capturedAt: Date.now() };
}

/** Builds a 54-example gesture (matching the real reported "super" gesture's
 *  size) by recording the same raw shape at 54 slightly different natural
 *  positions/seeds -- each independently run through extractHandFeatures(),
 *  exactly like record/App.tsx's real capture flow. */
function buildFiftyFourExampleGesture(): PersonalizedGesture {
  const examples: PersonalizedGestureExample[] = [];
  for (let i = 0; i < 54; i++) {
    examples.push(toExample(jitterRaw(RAW_OPEN_HAND, 0.015, i * 3.7)));
  }
  const now = Date.now();
  return {
    id: "test-gesture-54",
    name: "super",
    meaning: "super (synthetic 54-example set)",
    examples,
    enabled: true,
    createdAt: now,
    updatedAt: now,
  };
}

describe("Phase 9.3: full pipeline against a realistic 54-example gesture", () => {
  const gesture = buildFiftyFourExampleGesture();
  const wrist = RAW_OPEN_HAND[0];

  it("the recorded gesture actually has 54 examples (sanity check on the fixture itself)", () => {
    expect(gesture.examples).toHaveLength(54);
  });

  it("same pose, performed live at the SAME position/scale/angle, matches", () => {
    const liveFeatures = extractHandFeatures(jitterRaw(RAW_OPEN_HAND, 0.01, 999));
    const result = matchPersonalizedGestureRotationInvariant(liveFeatures.normalizedLandmarks, [gesture]);
    expect(result.matched).toBe(true);
    expect(result.gestureId).toBe("test-gesture-54");
    expect(result.distance).toBeLessThan(MAX_ACCEPTABLE_DISTANCE);
    expect(result.confidence).toBeGreaterThanOrEqual(MIN_MATCH_CONFIDENCE);
  });

  it("small translation (hand shifted elsewhere in the camera frame) still matches", () => {
    const shifted = translate(RAW_OPEN_HAND, 0.2, -0.15, 0);
    const liveFeatures = extractHandFeatures(jitterRaw(shifted, 0.01, 7));
    const result = matchPersonalizedGestureRotationInvariant(liveFeatures.normalizedLandmarks, [gesture]);
    expect(result.matched).toBe(true);
    expect(result.gestureId).toBe("test-gesture-54");
  });

  it("scale difference (hand closer to / farther from the camera) still matches", () => {
    const closer = scaleAbout(RAW_OPEN_HAND, 1.6, wrist); // hand appears much bigger (closer to camera)
    const fartherAway = scaleAbout(RAW_OPEN_HAND, 0.6, wrist); // hand appears much smaller (farther away)
    for (const variant of [closer, fartherAway]) {
      const liveFeatures = extractHandFeatures(jitterRaw(variant, 0.01, 11));
      const result = matchPersonalizedGestureRotationInvariant(liveFeatures.normalizedLandmarks, [gesture]);
      expect(result.matched).toBe(true);
      expect(result.gestureId).toBe("test-gesture-54");
    }
  });

  it("wrist rotation (natural in-plane hand tilt) still matches", () => {
    for (const degrees of [10, 20, 30]) {
      const rotated = rotateAboutZ(RAW_OPEN_HAND, degrees, wrist);
      const liveFeatures = extractHandFeatures(jitterRaw(rotated, 0.01, 13 + degrees));
      const result = matchPersonalizedGestureRotationInvariant(liveFeatures.normalizedLandmarks, [gesture]);
      expect(result.matched).toBe(true);
      expect(result.gestureId).toBe("test-gesture-54");
    }
  });

  it("natural combined movement (translation + scale + rotation + noise together) still matches", () => {
    const moved = rotateAboutZ(scaleAbout(translate(RAW_OPEN_HAND, -0.1, 0.08, 0), 1.2, wrist), 15, wrist);
    const liveFeatures = extractHandFeatures(jitterRaw(moved, 0.015, 42));
    const result = matchPersonalizedGestureRotationInvariant(liveFeatures.normalizedLandmarks, [gesture]);
    expect(result.matched).toBe(true);
    expect(result.gestureId).toBe("test-gesture-54");
  });

  it("slightly noisier landmarks (more camera/tracking jitter than a clean recording) still matches", () => {
    const liveFeatures = extractHandFeatures(jitterRaw(RAW_OPEN_HAND, 0.03, 55));
    const result = matchPersonalizedGestureRotationInvariant(liveFeatures.normalizedLandmarks, [gesture]);
    expect(result.matched).toBe(true);
  });

  it("distance/confidence stay comfortably inside the real thresholds across many natural variations (not a knife's-edge pass)", () => {
    const distances: number[] = [];
    const confidences: number[] = [];
    for (let i = 0; i < 20; i++) {
      const variant = rotateAboutZ(translate(RAW_OPEN_HAND, 0.03 * Math.sin(i), 0.02 * Math.cos(i), 0), 5 * Math.sin(i * 0.5), wrist);
      const liveFeatures = extractHandFeatures(jitterRaw(variant, 0.015, i * 17));
      const result = matchPersonalizedGestureRotationInvariant(liveFeatures.normalizedLandmarks, [gesture]);
      expect(result.matched).toBe(true);
      distances.push(result.distance);
      confidences.push(result.confidence);
    }
    expect(Math.max(...distances)).toBeLessThan(MAX_ACCEPTABLE_DISTANCE * 0.75); // real headroom, not barely passing
    expect(Math.min(...confidences)).toBeGreaterThan(MIN_MATCH_CONFIDENCE);
  });

  it("an unrelated hand pose (fist) does NOT match the 54-example open-hand gesture", () => {
    // Fist: all fingers curled toward the wrist -- built by pulling every
    // fingertip/joint back toward the wrist, structurally distinct from the
    // open-hand shape above.
    const fistRaw: Point3D[] = RAW_OPEN_HAND.map((p, i) => {
      if (i === 0) return p; // wrist unchanged
      const wristPoint = RAW_OPEN_HAND[0];
      return { x: wristPoint.x + (p.x - wristPoint.x) * 0.15, y: wristPoint.y + (p.y - wristPoint.y) * 0.15, z: p.z };
    });
    const liveFeatures = extractHandFeatures(jitterRaw(fistRaw, 0.01, 3));
    const result = matchPersonalizedGestureRotationInvariant(liveFeatures.normalizedLandmarks, [gesture]);
    expect(result.matched).toBe(false);
  });

  it("threshold constants used are the real, unmodified exported values (regression guard against silent threshold drift)", () => {
    expect(MAX_ACCEPTABLE_DISTANCE).toBe(0.35);
    expect(MIN_MATCH_CONFIDENCE).toBe(0.55);
    expect(AMBIGUITY_MARGIN).toBe(0.05);
  });
});
