/**
 * Temporal stabilization for the PERSONALIZED gesture matcher, mirroring
 * GestureStabilizer's rolling-window majority-vote design (see
 * gestureStabilizer.ts, which this deliberately does not modify) but keyed
 * on gestureId rather than GestureLabel: two personalized gestures can share
 * a display name (see the Phase 8.5 duplicate-name cleanup), so id -- not
 * name -- is the only safe identity to vote/stabilize on.
 *
 * One behavioral difference from GestureStabilizer, required by that same
 * id-vs-name distinction: GestureStabilizer's emitted event reuses the
 * CURRENT frame's confidence even when the majority-vote winner came from an
 * earlier frame in the window (harmless there -- it only skews a displayed
 * number, the winning LABEL itself is still correct). Here the winner is an
 * identity carrying its own name/meaning, so blindly attaching the current
 * frame's data could attach the WRONG gesture's name/meaning to the winning
 * id if the two happened to differ on the tick a transition is detected.
 * Instead, this stabilizer keeps each window entry's full match result and,
 * on a transition, reports the most recent entry that actually carries the
 * winning id -- self-consistent by construction.
 *
 * No event is emitted for the transition OUT of a stable personalized
 * gesture (back to "no match") -- PersonalizedGestureDetectedMessage (see
 * types/index.ts) has no null/cleared variant, matching the Phase 9 spec's
 * suggested payload. Internal state still resets on that transition, so a
 * later re-match of the SAME gesture correctly fires a new event rather than
 * being suppressed as "unchanged."
 */
import { STABILIZATION_MIN_OCCURRENCES, STABILIZATION_WINDOW_SIZE } from "./gestureConstants";
import type { PersonalizedGestureMatchResult } from "./personalizedGestureMatcher";

export interface PersonalizedStableGestureEvent {
  gestureId: string;
  name: string;
  meaning: string;
  confidence: number;
  distance: number;
  timestamp: number;
}

interface HistoryEntry {
  id: string | null;
  result: PersonalizedGestureMatchResult;
}

export class PersonalizedGestureStabilizer {
  private readonly windowSize: number;
  private readonly minOccurrences: number;
  private history: HistoryEntry[] = [];
  private lastStableId: string | null = null;

  constructor(
    windowSize: number = STABILIZATION_WINDOW_SIZE,
    minOccurrences: number = STABILIZATION_MIN_OCCURRENCES,
  ) {
    this.windowSize = windowSize;
    this.minOccurrences = minOccurrences;
  }

  /**
   * Feeds one frame's personalized match result into the rolling window.
   * Returns a PersonalizedStableGestureEvent only when the STABLE matched
   * gesture id changes to a new, non-null id -- i.e. only on transition INTO
   * a confidently-stable personalized gesture. Returns null otherwise
   * (nothing changed, or the stable state transitioned to "no match").
   */
  push(result: PersonalizedGestureMatchResult, timestamp: number): PersonalizedStableGestureEvent | null {
    const currentId = result.matched ? result.gestureId : null;
    this.history.push({ id: currentId, result });
    if (this.history.length > this.windowSize) this.history.shift();

    const counts = new Map<string | null, number>();
    for (const entry of this.history) {
      counts.set(entry.id, (counts.get(entry.id) ?? 0) + 1);
    }

    let winner: string | null = null;
    let winnerCount = 0;
    for (const [id, count] of counts) {
      if (count > winnerCount) {
        winner = id;
        winnerCount = count;
      }
    }

    const candidateStableId = winnerCount >= this.minOccurrences ? winner : null;
    if (candidateStableId === this.lastStableId) return null;

    this.lastStableId = candidateStableId;
    if (candidateStableId === null) return null; // transition to "no stable match" -- no event, see file header

    const latestMatchingEntry = [...this.history].reverse().find((entry) => entry.id === candidateStableId);
    // Cannot happen: candidateStableId only ever comes from an id present in
    // `history` (it's the key of a counted entry), so a matching entry
    // always exists. Guarded anyway rather than asserted with `!`, since
    // this is the one place a silent wrong-gesture event would be possible.
    if (!latestMatchingEntry) return null;

    const { result: matchedResult } = latestMatchingEntry;
    return {
      gestureId: candidateStableId,
      name: matchedResult.name ?? "",
      meaning: matchedResult.meaning ?? "",
      confidence: matchedResult.confidence,
      distance: matchedResult.distance,
      timestamp,
    };
  }

  /** Clears history -- call when the camera/hand-tracking stops, so a
   *  subsequent restart doesn't inherit stale votes from the last session
   *  (mirrors GestureStabilizer.reset()). */
  reset(): void {
    this.history = [];
    this.lastStableId = null;
  }

  /** DEBUG ONLY (Phase 9.1 diagnostics) -- read-only snapshot of the
   *  current rolling window's ids and the current stable id, for temporary
   *  [PERS-GESTURE-DEBUG] logging in offscreen.ts. Not consumed by, and has
   *  no effect on, any matching/stabilization decision. */
  getDebugSnapshot(): { window: (string | null)[]; stableId: string | null } {
    return { window: this.history.map((entry) => entry.id), stableId: this.lastStableId };
  }
}
