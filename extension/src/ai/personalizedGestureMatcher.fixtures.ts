/**
 * Shared synthetic hand-landmark fixtures for personalizedGestureMatcher's
 * test suites (personalizedGestureMatcher.test.ts's permanent regression
 * tests and personalizedGestureMatcher.validation.test.ts's exploratory
 * diagnostics). NOT a *.test.ts file itself -- test-support code only, not
 * picked up by Vitest's `include: ["src/**\/*.test.ts"]` and never imported
 * by any production code path.
 *
 * See personalizedGestureMatcher.validation.test.ts's header for why these
 * are synthetic (no real camera/browser access in this environment) and
 * what that does and doesn't prove.
 */
import type { Point3D } from "./gestureTypes";
import type { PersonalizedGesture, PersonalizedGestureExample } from "@/types";

// --- Synthetic hand skeletons ---------------------------------------------
// Built directly in normalized space (palm center ~ origin, scale ~1, same
// units normalizeLandmarks() produces) rather than simulating raw
// camera-space MediaPipe output + re-deriving normalization -- the matcher
// only ever sees already-normalized landmarks, so this is the correct
// level to construct fixtures at.

/** Open hand: all four hinge fingers + thumb extended away from the palm. */
export const OPEN_HAND: Point3D[] = [
  { x: 0.0, y: -1.0, z: 0.0 }, // 0 wrist
  { x: -0.3, y: -0.6, z: 0.1 }, // 1 thumb CMC
  { x: -0.5, y: -0.2, z: 0.15 }, // 2 thumb MCP
  { x: -0.65, y: 0.1, z: 0.2 }, // 3 thumb IP
  { x: -0.8, y: 0.4, z: 0.25 }, // 4 thumb TIP
  { x: -0.2, y: 0.0, z: 0.0 }, // 5 index MCP
  { x: -0.22, y: 0.5, z: 0.0 }, // 6 index PIP
  { x: -0.24, y: 0.85, z: 0.0 }, // 7 index DIP
  { x: -0.26, y: 1.15, z: 0.0 }, // 8 index TIP
  { x: 0.0, y: 0.05, z: 0.0 }, // 9 middle MCP
  { x: 0.0, y: 0.6, z: 0.0 }, // 10 middle PIP
  { x: 0.0, y: 1.0, z: 0.0 }, // 11 middle DIP
  { x: 0.0, y: 1.3, z: 0.0 }, // 12 middle TIP
  { x: 0.2, y: 0.0, z: 0.0 }, // 13 ring MCP
  { x: 0.22, y: 0.5, z: 0.0 }, // 14 ring PIP
  { x: 0.24, y: 0.85, z: 0.0 }, // 15 ring DIP
  { x: 0.26, y: 1.1, z: 0.0 }, // 16 ring TIP
  { x: 0.38, y: -0.05, z: 0.0 }, // 17 pinky MCP
  { x: 0.42, y: 0.35, z: 0.0 }, // 18 pinky PIP
  { x: 0.45, y: 0.6, z: 0.0 }, // 19 pinky DIP
  { x: 0.48, y: 0.85, z: 0.0 }, // 20 pinky TIP
];

/** Fist: all four hinge fingers + thumb curled back toward the palm. */
export const FIST: Point3D[] = [
  { x: 0.0, y: -1.0, z: 0.0 }, // 0 wrist
  { x: -0.3, y: -0.5, z: 0.1 }, // 1 thumb CMC
  { x: -0.35, y: -0.25, z: 0.2 }, // 2 thumb MCP
  { x: -0.3, y: -0.05, z: 0.3 }, // 3 thumb IP
  { x: -0.15, y: 0.05, z: 0.35 }, // 4 thumb TIP
  { x: -0.2, y: 0.0, z: 0.0 }, // 5 index MCP
  { x: -0.25, y: 0.2, z: 0.15 }, // 6 index PIP
  { x: -0.2, y: 0.05, z: 0.3 }, // 7 index DIP
  { x: -0.1, y: -0.05, z: 0.35 }, // 8 index TIP
  { x: 0.0, y: 0.05, z: 0.0 }, // 9 middle MCP
  { x: -0.02, y: 0.25, z: 0.15 }, // 10 middle PIP
  { x: 0.0, y: 0.1, z: 0.3 }, // 11 middle DIP
  { x: 0.05, y: -0.02, z: 0.35 }, // 12 middle TIP
  { x: 0.2, y: 0.0, z: 0.0 }, // 13 ring MCP
  { x: 0.22, y: 0.22, z: 0.15 }, // 14 ring PIP
  { x: 0.2, y: 0.08, z: 0.3 }, // 15 ring DIP
  { x: 0.15, y: -0.03, z: 0.35 }, // 16 ring TIP
  { x: 0.38, y: -0.05, z: 0.0 }, // 17 pinky MCP
  { x: 0.4, y: 0.15, z: 0.15 }, // 18 pinky PIP
  { x: 0.35, y: 0.02, z: 0.28 }, // 19 pinky DIP
  { x: 0.3, y: -0.08, z: 0.32 }, // 20 pinky TIP
];

type FingerName = "thumb" | "index" | "middle" | "ring" | "pinky";

const FINGER_RANGES: Record<FingerName, [number, number]> = {
  thumb: [1, 5],
  index: [5, 9],
  middle: [9, 13],
  ring: [13, 17],
  pinky: [17, 21],
};

/** Builds a hand shape by taking `base` and swapping in specific fingers
 *  from other shapes -- e.g. FIST with an OPEN_HAND thumb. Every shape
 *  built this way differs from `base` in ONLY the swapped finger(s)'
 *  landmarks (4 of 21 per finger), which is exactly the "concentrated
 *  difference" scenario this fix targets. */
function mergeFingers(base: Point3D[], overrides: Partial<Record<FingerName, Point3D[]>>): Point3D[] {
  const result = base.map((p) => ({ ...p }));
  for (const [finger, source] of Object.entries(overrides) as Array<[FingerName, Point3D[] | undefined]>) {
    if (!source) continue;
    const [start, end] = FINGER_RANGES[finger];
    for (let i = start; i < end; i++) result[i] = { ...source[i] };
  }
  return result;
}

/** Two fingers (index + middle) extended like OPEN_HAND, thumb/ring/pinky curled like FIST. */
export const TWO_FINGERS: Point3D[] = mergeFingers(FIST, { index: OPEN_HAND, middle: OPEN_HAND });

/** Thumb extended like OPEN_HAND, the four hinge fingers curled like FIST.
 *  Differs from FIST in ONLY the thumb (4/21 landmarks) -- the confirmed
 *  Phase 4 false-positive case. */
export const THUMB_OUT: Point3D[] = mergeFingers(FIST, { thumb: OPEN_HAND });

/** Index extended like OPEN_HAND, thumb/middle/ring/pinky curled like FIST
 *  ("point" shape). Differs from FIST in ONLY the index finger (4/21
 *  landmarks) -- a second, independent concentrated-difference case (see
 *  Phase 5 report, requirement 7). */
export const POINT_LIKE: Point3D[] = mergeFingers(FIST, { index: OPEN_HAND });

/** Index + middle + ring extended like OPEN_HAND, thumb/pinky curled like
 *  FIST. Differs from TWO_FINGERS in ONLY the ring finger (4/21 landmarks)
 *  -- a third, independent concentrated-difference case. */
export const THREE_FINGERS_LIKE: Point3D[] = mergeFingers(FIST, { index: OPEN_HAND, middle: OPEN_HAND, ring: OPEN_HAND });

/** Deliberate near-duplicate of OPEN_HAND (fingers spread very slightly
 *  less) -- a genuinely different personalized gesture a user might
 *  plausibly record, but geometrically close, to exercise the ambiguity
 *  guard against a real cross-gesture pair rather than only pure noise. */
export const OPEN_HAND_NARROW: Point3D[] = OPEN_HAND.map((p) => ({ x: p.x * 0.85, y: p.y, z: p.z }));

/** Halfway between OPEN_HAND and FIST -- an "incomplete"/in-transition
 *  gesture, neither fully open nor fully closed. */
export const PARTIAL_CURL: Point3D[] = OPEN_HAND.map((p, i) => ({
  x: (p.x + FIST[i].x) / 2,
  y: (p.y + FIST[i].y) / 2,
  z: (p.z + FIST[i].z) / 2,
}));

// --- Deterministic geometric transforms -----------------------------------

/** Deterministic per-landmark jitter (no Math.random() -- test output must
 *  be reproducible). `seed` shifts the phase so different "examples" of the
 *  same gesture don't collide. */
export function jitter(landmarks: Point3D[], magnitude: number, seed: number): Point3D[] {
  return landmarks.map((p, i) => ({
    x: p.x + magnitude * Math.sin(seed + i * 0.7),
    y: p.y + magnitude * Math.cos(seed + i * 1.3),
    z: p.z + magnitude * Math.sin(seed * 1.1 + i * 0.5),
  }));
}

/** Rotation about the Z axis (in-plane tilt -- the most common natural
 *  "tilt your hand sideways" motion relative to the camera). Landmarks are
 *  already palm-centered, so rotating about the origin is correct without
 *  any additional re-centering step. */
export function rotateZ(landmarks: Point3D[], degrees: number): Point3D[] {
  const rad = (degrees * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return landmarks.map((p) => ({ x: p.x * cos - p.y * sin, y: p.x * sin + p.y * cos, z: p.z }));
}

/** Rotation about the Y axis ("turning the hand like a doorknob" -- changes
 *  apparent depth). Secondary check alongside rotateZ(). */
export function rotateY(landmarks: Point3D[], degrees: number): Point3D[] {
  const rad = (degrees * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return landmarks.map((p) => ({ x: p.x * cos + p.z * sin, y: p.y, z: -p.x * sin + p.z * cos }));
}

export function toExample(landmarks: Point3D[]): PersonalizedGestureExample {
  return { normalizedLandmarks: landmarks, capturedAt: Date.now() };
}

export function buildGesture(
  id: string,
  name: string,
  base: Point3D[],
  options: { enabled?: boolean; jitterSeeds?: number[]; jitterMagnitude?: number } = {},
): PersonalizedGesture {
  const { enabled = true, jitterSeeds = [1, 2, 3, 4, 5], jitterMagnitude = 0.02 } = options;
  const now = Date.now();
  return {
    id,
    name,
    meaning: `${name} (synthetic)`,
    examples: jitterSeeds.map((seed) => toExample(jitter(base, jitterMagnitude, seed))),
    enabled,
    createdAt: now,
    updatedAt: now,
  };
}
