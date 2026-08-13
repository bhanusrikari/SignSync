/**
 * Gesture -> user-facing text mapping.
 *
 * IMPORTANT: these are prototype gesture commands/meanings for the current
 * hackathon implementation, NOT formal sign-language translations (ASL,
 * ISL, or otherwise). Keeping the mapping centralized here means the
 * classifier stays responsible only for recognizing physical hand shapes --
 * it (and gestureFeatures.ts / gestureStabilizer.ts / MediaPipe code) never
 * needs to know what a gesture "means".
 *
 * Pure, no chrome/DOM APIs -- consistent with the rest of ai/.
 */
import type { GestureLabel, RecognizedGestureText, StableGestureEvent } from "./gestureTypes";

/** Centralized gesture -> text mapping. Change meanings here only. */
export const GESTURE_VOCABULARY: Record<GestureLabel, string | null> = {
  OPEN_PALM: "Hello",
  FIST: "Stop",
  THUMBS_UP: "Yes",
  PEACE: "Peace",
  POINT: "Attention",
  UNKNOWN: null,
};

/** Looks up the user-facing text for a recognized gesture label. */
export function getGestureText(gesture: GestureLabel): string | null {
  return GESTURE_VOCABULARY[gesture];
}

/**
 * Maps a stabilizer's StableGestureEvent onto its recognized text, without
 * altering gesture/confidence/timestamp. This is the one place a stable
 * gesture becomes user-facing text -- call it once per stable transition,
 * never per detection frame.
 */
export function mapToRecognizedGestureText(event: StableGestureEvent): RecognizedGestureText {
  return {
    gesture: event.gesture,
    text: getGestureText(event.gesture),
    confidence: event.confidence,
    timestamp: event.timestamp,
  };
}
