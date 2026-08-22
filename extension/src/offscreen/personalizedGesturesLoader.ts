/**
 * Wraps "fetch the current list of personalized gestures" with the exact
 * refresh semantics the live pipeline needs (Phase 9.1 fix, see
 * offscreen.ts):
 *
 *  - reload() always performs a fresh fetch -- it is never gated on any
 *    "already loaded once" / "tracker already loaded" flag. The CALLER
 *    decides WHEN to refresh (offscreen.ts calls it on every recognition
 *    activation); this module has no opinion on that, only on making a
 *    requested refresh actually happen.
 *  - get() is a synchronous, side-effect-free accessor over the last
 *    successfully loaded list. This is what the per-frame detection loop
 *    reads, so the frame loop itself can never perform a fetch/IndexedDB
 *    read -- reload() and get() are structurally separate, not just
 *    separated by convention.
 *  - Concurrent reload() calls share one in-flight fetch instead of firing
 *    overlapping reads that could resolve out of order (a genuinely fresher
 *    read finishing first, then being clobbered by a stale one finishing
 *    later).
 *  - A failed fetch never throws, and never destroys a previously loaded
 *    list -- get() keeps returning the last successfully loaded gestures
 *    until a LATER reload() actually succeeds. A transient failure (e.g. a
 *    momentary IndexedDB hiccup) must not silently disable live personalized
 *    recognition for gestures that were already working. Only ever starts
 *    out empty if the very first reload() fails before anything has ever
 *    loaded successfully.
 *

 * This is the root-cause fix for "live personalized recognition never
 * appears despite valid stored data": offscreen.ts previously only loaded
 * personalized gestures once, when the hand-tracking model first loaded,
 * and never again for the rest of that offscreen document's lifetime --
 * see the Phase 9.1 report. A gesture recorded, merged, or edited via
 * record.html/validate.html (separate documents/tabs writing straight to
 * IndexedDB) was invisible to an already-running offscreen document's live
 * matching until Gesture Recognition was toggled off and back on.
 *
 * Extracted out of offscreen.ts so this refresh mechanism is unit-testable
 * without any DOM/chrome/MediaPipe mocking -- this project's vitest config
 * deliberately keeps DOM/Chrome APIs out of scope for its "node"-environment
 * unit tests (see vitest.config.ts), so offscreen.ts's own DOM/camera
 * orchestration stays untested directly, same as before this phase; this
 * class is what actually needed proving.
 */
import type { PersonalizedGesture } from "@/types";

export class RefreshablePersonalizedGesturesLoader {
  private current: PersonalizedGesture[] = [];
  private inFlight: Promise<PersonalizedGesture[]> | null = null;

  constructor(private readonly fetchGestures: () => Promise<PersonalizedGesture[]>) {}

  /** Last successfully loaded list. Never triggers a fetch -- safe to call
   *  every frame. */
  get(): PersonalizedGesture[] {
    return this.current;
  }

  /** Always performs a fresh fetch (deduped against any already in-flight
   *  one -- see the file header) and updates what get() returns on success.
   *  Never throws, and never clears a previously loaded list on failure --
   *  see the file header's "never destroys a previously loaded list" note. */
  reload(): Promise<PersonalizedGesture[]> {
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.fetchGestures()
      .then((gestures) => {
        this.current = gestures;
        console.log(
          `[PERS-GESTURE-DEBUG] LOADER STATE count=${gestures.length} ids=${gestures.map((g) => g.id).join(",")}`,
        );
        return gestures;
      })
      .catch((error) => {
        console.warn(
          "[SignSync] failed to refresh personalized gestures, keeping the last known-good list:",
          error,
        );
        console.log(
          `[PERS-GESTURE-DEBUG] LOADER STATE refresh FAILED, keeping previous count=${this.current.length}`,
        );
        return this.current; // deliberately NOT cleared -- see reload()'s doc comment
      })
      .finally(() => {
        this.inFlight = null;
      });
    return this.inFlight;
  }
}
