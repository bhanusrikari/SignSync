import { describe, expect, it, vi } from "vitest";
import { RefreshablePersonalizedGesturesLoader } from "./personalizedGesturesLoader";
import { buildGesture, OPEN_HAND } from "@/ai/personalizedGestureMatcher.fixtures";
import type { PersonalizedGesture } from "@/types";

describe("RefreshablePersonalizedGesturesLoader", () => {
  it("1. get() returns an empty list before the first reload() ever runs", () => {
    const loader = new RefreshablePersonalizedGesturesLoader(async () => [buildGesture("F85B78", "super", OPEN_HAND)]);
    expect(loader.get()).toEqual([]);
  });

  it("2. a gesture added to storage after construction becomes available once reload() is called", async () => {
    // Simulates: offscreen document starts with zero personalized gestures
    // recorded yet, then the user records "super" (in record.html, a
    // separate document writing straight to IndexedDB) before the next
    // recognition activation.
    let stored: PersonalizedGesture[] = [];
    const loader = new RefreshablePersonalizedGesturesLoader(async () => stored);

    await loader.reload();
    expect(loader.get()).toHaveLength(0);

    stored = [buildGesture("F85B78", "super", OPEN_HAND)];
    await loader.reload();

    expect(loader.get()).toHaveLength(1);
    expect(loader.get()[0].id).toBe("F85B78");
  });

  it("3. a gesture removed/changed in storage is reflected on the next reload()", async () => {
    let stored: PersonalizedGesture[] = [buildGesture("F85B78", "super", OPEN_HAND)];
    const loader = new RefreshablePersonalizedGesturesLoader(async () => stored);

    await loader.reload();
    expect(loader.get()).toHaveLength(1);

    stored = []; // e.g. deleted, or merged away as a duplicate source record
    await loader.reload();
    expect(loader.get()).toHaveLength(0);
  });

  it("4. multiple reloads correctly track the list up, down, and up again", async () => {
    let stored: PersonalizedGesture[] = [buildGesture("F85B78", "super", OPEN_HAND)];
    const loader = new RefreshablePersonalizedGesturesLoader(async () => stored);

    await loader.reload();
    expect(loader.get()).toHaveLength(1);

    // A second gesture is added, and the tracker/hand-tracking stays loaded
    // the whole time -- toggling Gesture Recognition off/on (or any other
    // trigger for a fresh startCamera() activation) must call reload()
    // again and see it, not reuse the first snapshot.
    stored = [...stored, buildGesture("thanks-id", "thanks", OPEN_HAND)];
    await loader.reload();
    expect(loader.get()).toHaveLength(2);
    expect(loader.get().map((g) => g.id).sort()).toEqual(["F85B78", "thanks-id"]);

    // And back down again -- proves this isn't a union/merge, each reload()
    // reflects the CURRENT state exactly.
    stored = [];
    await loader.reload();
    expect(loader.get()).toHaveLength(0);
  });

  it("5. concurrent reload() calls are deduplicated into one in-flight fetch", async () => {
    let resolveFetch: (value: PersonalizedGesture[]) => void = () => {};
    const fetchGestures = vi.fn(
      () =>
        new Promise<PersonalizedGesture[]>((resolve) => {
          resolveFetch = resolve;
        }),
    );
    const loader = new RefreshablePersonalizedGesturesLoader(fetchGestures);

    const first = loader.reload();
    const second = loader.reload(); // fired before the first settles
    expect(fetchGestures).toHaveBeenCalledTimes(1); // deduped, not 2

    resolveFetch([buildGesture("F85B78", "super", OPEN_HAND)]);
    await Promise.all([first, second]);
    expect(loader.get()).toHaveLength(1);

    // Once settled, the NEXT reload() is a genuinely fresh fetch again --
    // checked synchronously right after calling it (without awaiting its
    // resolution): fetchGestures() is invoked synchronously inside reload(),
    // before any microtask, so the call count updates immediately.
    const third = loader.reload();
    expect(fetchGestures).toHaveBeenCalledTimes(2);
    resolveFetch([]); // settle it so no promise is left dangling after the test
    await third;
  });

  it("6. get() never triggers a fetch -- reading it every frame performs zero IndexedDB/service reads", async () => {
    const fetchGestures = vi.fn(async () => [buildGesture("F85B78", "super", OPEN_HAND)]);
    const loader = new RefreshablePersonalizedGesturesLoader(fetchGestures);

    await loader.reload();
    expect(fetchGestures).toHaveBeenCalledTimes(1);

    // Simulate ~8 frames/sec worth of per-frame reads (the live detection
    // loop's actual cadence, see offscreen.ts's DETECTION_INTERVAL_MS) --
    // none of them may call fetchGestures again.
    for (let i = 0; i < 100; i++) {
      loader.get();
    }
    expect(fetchGestures).toHaveBeenCalledTimes(1);
  });

  it("7. the detection loop's read (get()) sees a list refreshed by a concurrently-awaited reload()", async () => {
    // Models offscreen.ts's actual usage: startCamera() awaits reload()
    // before returning, and the frame loop's very next tick calls get()
    // afterward -- this proves that sequencing actually hands the frame
    // loop fresh data, not a promise it would need to unwrap itself.
    let stored: PersonalizedGesture[] = [];
    const loader = new RefreshablePersonalizedGesturesLoader(async () => stored);
    stored = [buildGesture("F85B78", "super", OPEN_HAND)];

    await loader.reload(); // what startCamera() does
    const detectionLoopFrame = loader.get(); // what the frame loop does, every tick
    expect(detectionLoopFrame).toHaveLength(1);
    expect(detectionLoopFrame[0].id).toBe("F85B78");
  });

  it("8. a failed refresh does NOT destroy a previously loaded valid list", async () => {
    let shouldFail = false;
    const loader = new RefreshablePersonalizedGesturesLoader(async () => {
      if (shouldFail) throw new Error("transient IndexedDB error");
      return [buildGesture("F85B78", "super", OPEN_HAND)];
    });

    await loader.reload();
    expect(loader.get()).toHaveLength(1);

    shouldFail = true;
    await expect(loader.reload()).resolves.toHaveLength(1); // resolves with the kept list, doesn't throw
    expect(loader.get()).toHaveLength(1); // NOT wiped to []
    expect(loader.get()[0].id).toBe("F85B78");

    // A later successful reload still works normally afterward.
    shouldFail = false;
    await loader.reload();
    expect(loader.get()).toHaveLength(1);
  });

  it("a failed fetch on the very FIRST reload() (nothing ever loaded yet) leaves get() empty, not throwing", async () => {
    const loader = new RefreshablePersonalizedGesturesLoader(async () => {
      throw new Error("IndexedDB unavailable");
    });

    await expect(loader.reload()).resolves.toEqual([]);
    expect(loader.get()).toEqual([]);
  });
});
