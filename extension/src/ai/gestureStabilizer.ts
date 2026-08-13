/**
 * Temporal stabilization: prevents flickering / one-frame false positives
 * (e.g. OPEN_PALM -> UNKNOWN -> OPEN_PALM across consecutive frames) by
 * requiring a gesture to win a majority vote within a rolling window before
 * it's reported as "stable". Parameters are constructor-injectable and
 * default to gestureConstants.ts's values.
 */
import { STABILIZATION_MIN_OCCURRENCES, STABILIZATION_WINDOW_SIZE } from "./gestureConstants";
import type { GestureClassificationResult, GestureLabel, StableGestureEvent } from "./gestureTypes";

export class GestureStabilizer {
  private readonly windowSize: number;
  private readonly minOccurrences: number;
  private history: GestureLabel[] = [];
  private lastStable: GestureLabel = "UNKNOWN";

  constructor(
    windowSize: number = STABILIZATION_WINDOW_SIZE,
    minOccurrences: number = STABILIZATION_MIN_OCCURRENCES,
  ) {
    this.windowSize = windowSize;
    this.minOccurrences = minOccurrences;
  }

  /**
   * Feeds one frame's raw classification result into the rolling window.
   * Returns a StableGestureEvent only when the STABLE gesture changes from
   * its previous value, so callers can react to transitions instead of
   * every single frame. Returns null when nothing changed.
   */
  push(result: GestureClassificationResult, timestamp: number): StableGestureEvent | null {
    this.history.push(result.gesture);
    if (this.history.length > this.windowSize) this.history.shift();

    const counts = new Map<GestureLabel, number>();
    for (const gesture of this.history) {
      counts.set(gesture, (counts.get(gesture) ?? 0) + 1);
    }

    let winner: GestureLabel = "UNKNOWN";
    let winnerCount = 0;
    for (const [gesture, count] of counts) {
      if (count > winnerCount) {
        winner = gesture;
        winnerCount = count;
      }
    }

    const candidateStable = winnerCount >= this.minOccurrences ? winner : "UNKNOWN";
    if (candidateStable === this.lastStable) return null;

    this.lastStable = candidateStable;
    return { gesture: candidateStable, confidence: result.confidence, timestamp };
  }

  /** Clears history -- call when the camera/hand-tracking stops, so a
   *  subsequent restart doesn't inherit stale votes from the last session. */
  reset(): void {
    this.history = [];
    this.lastStable = "UNKNOWN";
  }
}
