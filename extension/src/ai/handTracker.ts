/**
 * Thin wrapper around MediaPipe's HandLandmarker (Tasks Vision). Owns model
 * loading and per-frame detection only -- no gesture classification, no
 * feature extraction, no smoothing, no DOM/messaging concerns. Pure CV,
 * consumed by the offscreen document that owns the camera stream.
 *
 * The Wasm runtime and model weights are bundled locally under
 * extension/public/mediapipe/ and extension/public/models/ -- MV3 forbids
 * loading remotely-hosted executable code, so this can't point at a CDN.
 */
import { FilesetResolver, HandLandmarker } from "@mediapipe/tasks-vision";
import type { NormalizedLandmark } from "@mediapipe/tasks-vision";

export interface HandDetectionResult {
  handsDetected: number;
  /** One array of 21 normalized landmarks per detected hand. */
  landmarks: NormalizedLandmark[][];
}

let handLandmarker: HandLandmarker | null = null;

/** Loads the Wasm runtime + bundled model. Must resolve before detectHands()
 *  is called. Safe to call again once already loaded (no-op). */
export async function loadHandTracker(): Promise<void> {
  if (handLandmarker) return;
  const vision = await FilesetResolver.forVisionTasks(
    chrome.runtime.getURL("mediapipe/wasm"),
  );
  handLandmarker = await HandLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath: chrome.runtime.getURL("models/hand_landmarker.task"),
      delegate: "CPU",
    },
    runningMode: "VIDEO",
    numHands: 1,
  });
}

export function isHandTrackerLoaded(): boolean {
  return handLandmarker !== null;
}

/** Runs detection against the current video frame. Throws if called before
 *  loadHandTracker() has resolved. */
export function detectHands(video: HTMLVideoElement, timestampMs: number): HandDetectionResult {
  if (!handLandmarker) {
    throw new Error("detectHands() called before loadHandTracker() resolved");
  }
  const result = handLandmarker.detectForVideo(video, timestampMs);
  return { handsDetected: result.landmarks.length, landmarks: result.landmarks };
}

/** Releases Wasm/GPU resources. Safe to call even if never loaded. */
export function disposeHandTracker(): void {
  handLandmarker?.close();
  handLandmarker = null;
}
