/**
 * Pure feature extraction: MediaPipe's 21 raw hand landmarks -> a
 * normalized, hand-shape-only feature set. No MediaPipe import, no DOM/
 * browser API, no side effects -- testable with plain landmark fixtures.
 *
 * Standard MediaPipe hand topology (21 points):
 *   0     wrist
 *   1-4   thumb  (CMC, MCP, IP, TIP)
 *   5-8   index  (MCP, PIP, DIP, TIP)
 *   9-12  middle (MCP, PIP, DIP, TIP)
 *   13-16 ring   (MCP, PIP, DIP, TIP)
 *   17-20 pinky  (MCP, PIP, DIP, TIP)
 */
import { CURL_CURLED_MIN, CURL_EXTENDED_MAX, THUMB_RATIO_MAX, THUMB_RATIO_MIN } from "./gestureConstants";
import type { FingerCurlScores, HandFeatures, Point3D } from "./gestureTypes";

const WRIST = 0;
const THUMB_MCP = 2;
const THUMB_TIP = 4;
const INDEX_MCP = 5;
const MIDDLE_MCP = 9;
const RING_MCP = 13;
const PINKY_MCP = 17;

// [mcp, pip, tip] indices for each hinge finger's joint-angle curl.
const FINGER_JOINTS = {
  index: [5, 6, 8],
  middle: [9, 10, 12],
  ring: [13, 14, 16],
  pinky: [17, 18, 20],
} as const;

function subtract(a: Point3D, b: Point3D): Point3D {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function magnitude(v: Point3D): number {
  return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
}

function distance(a: Point3D, b: Point3D): number {
  return magnitude(subtract(a, b));
}

/** Angle between two vectors, in degrees, in [0, 180]. */
function angleBetweenDeg(v1: Point3D, v2: Point3D): number {
  const m1 = magnitude(v1);
  const m2 = magnitude(v2);
  if (m1 === 0 || m2 === 0) return 0;
  const dot = v1.x * v2.x + v1.y * v2.y + v1.z * v2.z;
  const cos = Math.min(1, Math.max(-1, dot / (m1 * m2)));
  return (Math.acos(cos) * 180) / Math.PI;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** Curl for one of the four hinge fingers: the angle between the MCP->PIP
 *  and PIP->TIP bone vectors. ~0deg when straight (both bones point the
 *  same way), ~180deg when fully curled (TIP folds back over PIP). */
function hingeFingerCurl(landmarks: Point3D[], mcpIdx: number, pipIdx: number, tipIdx: number): number {
  const bone1 = subtract(landmarks[pipIdx], landmarks[mcpIdx]);
  const bone2 = subtract(landmarks[tipIdx], landmarks[pipIdx]);
  return clamp01(angleBetweenDeg(bone1, bone2) / 180);
}

/** Thumb curl: the thumb bends mostly by abduction rather than a clean PIP
 *  hinge, so the joint-angle method above is unreliable for it. Instead,
 *  compare how far the tip sits from the wrist relative to how far its own
 *  base (MCP) sits from the wrist -- extended thumbs reach far past their
 *  base, curled/tucked thumbs fold back toward it. */
function thumbCurl(landmarks: Point3D[]): number {
  const wrist = landmarks[WRIST];
  const baseDist = distance(landmarks[THUMB_MCP], wrist);
  if (baseDist === 0) return 1; // degenerate geometry -- treat as curled
  const ratio = distance(landmarks[THUMB_TIP], wrist) / baseDist;
  const normalized = (ratio - THUMB_RATIO_MIN) / (THUMB_RATIO_MAX - THUMB_RATIO_MIN);
  return clamp01(1 - normalized); // higher ratio (more extended) -> lower curl
}

/** Translates landmarks so the palm center is the origin, then scales by a
 *  hand-size reference (wrist-to-middle-MCP distance) -- makes the result
 *  insensitive to where the hand is in frame, how big it looks, or how far
 *  it is from the camera. */
function normalizeLandmarks(landmarks: Point3D[]): Point3D[] {
  const palmCenter: Point3D = {
    x: (landmarks[INDEX_MCP].x + landmarks[MIDDLE_MCP].x + landmarks[RING_MCP].x + landmarks[PINKY_MCP].x) / 4,
    y: (landmarks[INDEX_MCP].y + landmarks[MIDDLE_MCP].y + landmarks[RING_MCP].y + landmarks[PINKY_MCP].y) / 4,
    z: (landmarks[INDEX_MCP].z + landmarks[MIDDLE_MCP].z + landmarks[RING_MCP].z + landmarks[PINKY_MCP].z) / 4,
  };
  const scale = distance(landmarks[WRIST], landmarks[MIDDLE_MCP]) || 1;
  return landmarks.map((point) => ({
    x: (point.x - palmCenter.x) / scale,
    y: (point.y - palmCenter.y) / scale,
    z: (point.z - palmCenter.z) / scale,
  }));
}

/**
 * Converts 21 raw MediaPipe hand landmarks (single hand) into a normalized
 * feature set. Throws if the input isn't a 21-point hand -- MediaPipe should
 * always return 21 points per detected hand, but this keeps the boundary
 * explicit rather than silently indexing into malformed data.
 */
export function extractHandFeatures(landmarks: Point3D[]): HandFeatures {
  if (landmarks.length !== 21) {
    throw new Error(`extractHandFeatures expected 21 landmarks, got ${landmarks.length}`);
  }

  const curl: FingerCurlScores = {
    thumb: thumbCurl(landmarks),
    index: hingeFingerCurl(landmarks, ...FINGER_JOINTS.index),
    middle: hingeFingerCurl(landmarks, ...FINGER_JOINTS.middle),
    ring: hingeFingerCurl(landmarks, ...FINGER_JOINTS.ring),
    pinky: hingeFingerCurl(landmarks, ...FINGER_JOINTS.pinky),
  };

  return { curl, normalizedLandmarks: normalizeLandmarks(landmarks) };
}

/** True if `curlScore` confidently reads as an extended (straight) finger. */
export function isExtended(curlScore: number): boolean {
  return curlScore <= CURL_EXTENDED_MAX;
}

/** True if `curlScore` confidently reads as a curled finger. */
export function isCurled(curlScore: number): boolean {
  return curlScore >= CURL_CURLED_MIN;
}
