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
import type { LanguageCode } from "@/types";

/** Centralized gesture -> text mapping. Change meanings here only. */
export const GESTURE_VOCABULARY: Record<GestureLabel, string | null> = {
  OPEN_PALM: "Hello",
  FIST: "Stop",
  THUMBS_UP: "Yes",
  PEACE: "Peace",
  POINT: "Attention",
  UNKNOWN: null,
};

/**
 * Localized presentation text per gesture, per language (Phase 10 Part 9).
 * Purely additive: GESTURE_VOCABULARY/getGestureText/mapToRecognizedGestureText
 * above stay completely unchanged, so offscreen.ts's GESTURE_DETECTED
 * message (built by mapToRecognizedGestureText -- see offscreen.ts) is
 * untouched and always carries the English text, exactly as before this
 * phase. Localization happens at the PRESENTATION layer (the content
 * script, which already has the user's selected language via
 * SignSyncState) via getLocalizedGestureText() below, not inside the
 * recognition pipeline itself -- keeps the AI pipeline's output stable and
 * testable independent of the user's language choice.
 *
 * These are still prototype gesture commands, not formal sign-language
 * translations -- same caveat as GESTURE_VOCABULARY above, now repeated
 * per language rather than fixed to English.
 */
const GESTURE_VOCABULARY_BY_LANGUAGE: Record<LanguageCode, Record<GestureLabel, string | null>> = {
  "en-IN": GESTURE_VOCABULARY,
  "hi-IN": {
    OPEN_PALM: "नमस्ते",
    FIST: "रुको",
    THUMBS_UP: "हाँ",
    PEACE: "शांति",
    POINT: "ध्यान दें",
    UNKNOWN: null,
  },
  "te-IN": {
    OPEN_PALM: "నమస్కారం",
    FIST: "ఆగు",
    THUMBS_UP: "అవును",
    PEACE: "శాంతి",
    POINT: "శ్రద్ధ వహించండి",
    UNKNOWN: null,
  },
};

/** Looks up the user-facing text for a recognized gesture label, in the
 *  given language -- falls back to English if the gesture is somehow
 *  missing from that language's table (should never happen given the table
 *  above covers every GestureLabel for every language, but never throws or
 *  returns undefined either way). */
export function getLocalizedGestureText(gesture: GestureLabel, language: LanguageCode): string | null {
  const table = GESTURE_VOCABULARY_BY_LANGUAGE[language] ?? GESTURE_VOCABULARY;
  return table[gesture] ?? GESTURE_VOCABULARY[gesture];
}

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
