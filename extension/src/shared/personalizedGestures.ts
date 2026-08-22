/**
 * Pure data-model validation for personalized gestures (see
 * services/personalizedGestures.ts for the chrome.storage.local-backed CRUD
 * API that uses these). No chrome/DOM APIs here -- testable with plain
 * fixtures, consistent with shared/camera.ts and
 * shared/speechRecognitionErrors.ts.
 */
import type { LanguageCode, PersonalizedGesture, PersonalizedGestureExample } from "@/types";
import type { Point3D } from "@/ai/gestureTypes";

const VALID_LANGUAGE_CODES: LanguageCode[] = ["en-IN", "hi-IN", "te-IN"];

/** Key used for the personalized-gestures record in chrome.storage.local --
 *  deliberately separate from shared/constants.ts's STORAGE_KEY (the single
 *  SignSyncState settings record), since this is a different, growable
 *  concern. */
export const PERSONALIZED_GESTURES_STORAGE_KEY = "signSyncPersonalizedGestures";

/** MediaPipe always reports 21 landmarks per hand (see gestureFeatures.ts),
 *  and HandFeatures.normalizedLandmarks preserves that count -- an example
 *  with any other count can't be a real captured snapshot. */
const LANDMARK_COUNT = 21;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isPoint3D(value: unknown): value is Point3D {
  if (typeof value !== "object" || value === null) return false;
  const point = value as Record<string, unknown>;
  return isFiniteNumber(point.x) && isFiniteNumber(point.y) && isFiniteNumber(point.z);
}

/** Exported so ai/personalizedGestureMatcher.ts can filter malformed
 *  examples out of an otherwise-valid gesture without re-implementing this
 *  same shape check. */
export function isPersonalizedGestureExample(value: unknown): value is PersonalizedGestureExample {
  if (typeof value !== "object" || value === null) return false;
  const example = value as Record<string, unknown>;
  return (
    Array.isArray(example.normalizedLandmarks) &&
    example.normalizedLandmarks.length === LANDMARK_COUNT &&
    example.normalizedLandmarks.every(isPoint3D) &&
    isFiniteNumber(example.capturedAt)
  );
}

/** Non-empty and not just whitespace. */
function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Structural + content validation for one personalized gesture. Deliberately
 * does NOT enforce a minimum example count (e.g. "5-10 examples") here --
 * that's a recording-flow UX policy for a later phase, not a data-model
 * invariant. At least one example is still required: a gesture with zero
 * examples can never be matched against anything, so it isn't meaningful
 * stored data.
 */
/** True if `value` is absent (localizedMeanings is optional -- see
 *  PersonalizedGesture's doc comment) or a well-formed
 *  Partial<Record<LanguageCode, string>>: only recognized language codes as
 *  keys, only non-empty strings as values. A malformed value here doesn't
 *  invalidate the WHOLE gesture in isValidPersonalizedGesture below -- it's
 *  checked separately so a corrupted localizedMeanings blob can't
 *  accidentally make an otherwise-valid, already-recorded gesture
 *  (including real matcher-critical landmark data) disappear. */
function isValidLocalizedMeanings(value: unknown): boolean {
  if (value === undefined) return true;
  if (typeof value !== "object" || value === null) return false;
  return Object.entries(value as Record<string, unknown>).every(
    ([key, text]) => VALID_LANGUAGE_CODES.includes(key as LanguageCode) && isNonEmptyString(text),
  );
}

export function isValidPersonalizedGesture(value: unknown): value is PersonalizedGesture {
  if (typeof value !== "object" || value === null) return false;
  const gesture = value as Record<string, unknown>;
  return (
    isNonEmptyString(gesture.id) &&
    isNonEmptyString(gesture.name) &&
    isNonEmptyString(gesture.meaning) &&
    isValidLocalizedMeanings(gesture.localizedMeanings) &&
    Array.isArray(gesture.examples) &&
    gesture.examples.length > 0 &&
    gesture.examples.every(isPersonalizedGestureExample) &&
    typeof gesture.enabled === "boolean" &&
    isFiniteNumber(gesture.createdAt) &&
    isFiniteNumber(gesture.updatedAt)
  );
}

/** Resolves the meaning to show/speak for `gesture` in `language` --
 *  localizedMeanings[language] if present and non-empty, otherwise the
 *  always-present default `meaning` (Phase 10 Part 9). Never throws, never
 *  returns an empty string for a valid gesture. */
export function getLocalizedMeaning(gesture: PersonalizedGesture, language: LanguageCode): string {
  return gesture.localizedMeanings?.[language] ?? gesture.meaning;
}

/**
 * Resolves the localized meaning for a live PERSONALIZED_GESTURE_DETECTED
 * event (Phase 11 Part B) -- looks `gestureId` up in `gestures` (the same
 * enabled-gesture list the matcher itself ran against, e.g.
 * personalizedGesturesLoader.get() in offscreen.ts) and applies
 * getLocalizedMeaning(). `fallbackMeaning` (the matcher's own, always-
 * English PersonalizedGestureMatchResult.meaning) is used verbatim if the
 * gesture can't be found -- e.g. it was deleted/disabled between the match
 * and this lookup -- so a live detection can never be dropped or crash
 * over a localization lookup miss. Pure and side-effect-free: extracted so
 * this resolution logic is unit-testable without mocking chrome.runtime or
 * the offscreen document's module state.
 */
export function resolvePersonalizedGestureMeaning(
  gestures: readonly PersonalizedGesture[],
  gestureId: string,
  fallbackMeaning: string,
  language: LanguageCode,
): string {
  const gesture = gestures.find((g) => g.id === gestureId);
  return gesture ? getLocalizedMeaning(gesture, language) : fallbackMeaning;
}

/**
 * Sanitizes a raw chrome.storage.local value of unknown shape into a valid
 * PersonalizedGesture[]. Missing storage (undefined) becomes an empty list;
 * a non-array value, or any malformed/corrupted individual entry, is
 * dropped rather than thrown -- one bad record must never break the whole
 * store or crash a reader.
 */
export function sanitizeStoredPersonalizedGestures(value: unknown): PersonalizedGesture[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isValidPersonalizedGesture);
}

/** Stable, unique id generator. Falls back to a manual random id if
 *  crypto.randomUUID isn't available in this context. */
export function generatePersonalizedGestureId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `pg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}
