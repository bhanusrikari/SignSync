import { beforeEach, describe, expect, it } from "vitest";
import { installFakeIndexedDb } from "./fakeIndexedDb";
import {
  _resetConnectionForTests,
  getAllGestureRecords,
  getExampleRecord,
  getExamplesByGestureId,
  putExampleRecord,
} from "./personalizedGesturesDb";
import {
  _resetMigrationStateForTests,
  deletePersonalizedGesture,
  getPersonalizedGesture,
  getPersonalizedGestures,
  mergePersonalizedGestures,
  savePersonalizedGesture,
  setPersonalizedGestureEnabled,
  updatePersonalizedGesture,
} from "./personalizedGestures";
import { validatePersonalizedGestures } from "@/ai/personalizedGestureValidation";
import { PERSONALIZED_GESTURES_STORAGE_KEY } from "@/shared/personalizedGestures";
import type { PersonalizedGesture, PersonalizedGestureExample } from "@/types";
import type { Point3D } from "@/ai/gestureTypes";

/**
 * Minimal in-memory fake of the chrome.storage.local surface this module
 * uses (get/set) -- needed both because the "real" personalized-gesture
 * data still lives behind this API for the migration source, and because
 * the migration-complete flag is stored here too (see personalizedGestures.ts).
 */
function installFakeChromeStorage(): { store: Record<string, unknown> } {
  const state = { store: {} as Record<string, unknown> };
  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: {
      local: {
        get: async (key: string) => ({ [key]: state.store[key] }),
        set: async (items: Record<string, unknown>) => {
          state.store = { ...state.store, ...items };
        },
      },
    },
  };
  return state;
}

function makeLandmarks(offset = 0): Point3D[] {
  return Array.from({ length: 21 }, (_, i) => ({ x: i * 0.01 + offset, y: i * 0.02, z: 0 }));
}

function makeExamples(count = 1): PersonalizedGestureExample[] {
  return Array.from({ length: count }, (_, i) => ({ normalizedLandmarks: makeLandmarks(i * 0.001), capturedAt: Date.now() }));
}

let chromeStorage: { store: Record<string, unknown> };

beforeEach(() => {
  _resetConnectionForTests();
  _resetMigrationStateForTests();
  installFakeIndexedDb();
  chromeStorage = installFakeChromeStorage();
});

describe("1. create gesture", () => {
  it("saves and retrieves a gesture", async () => {
    const saved = await savePersonalizedGesture({ name: "Busy", meaning: "I'm busy right now", examples: makeExamples() });

    expect(saved.id).toBeTruthy();
    expect(saved.enabled).toBe(true);
    expect(saved.createdAt).toBe(saved.updatedAt);

    const all = await getPersonalizedGestures();
    expect(all).toEqual([saved]);
  });

  it("returns an empty list before anything is saved", async () => {
    expect(await getPersonalizedGestures()).toEqual([]);
  });

  it("rejects saving a gesture with an invalid name", async () => {
    await expect(savePersonalizedGesture({ name: "", meaning: "x", examples: makeExamples() })).rejects.toThrow();
    expect(await getPersonalizedGestures()).toEqual([]);
  });

  it("10. rejects malformed landmark data (wrong count / non-finite)", async () => {
    const badCount = [{ normalizedLandmarks: makeLandmarks().slice(0, 5), capturedAt: Date.now() }];
    await expect(savePersonalizedGesture({ name: "Busy", meaning: "x", examples: badCount })).rejects.toThrow();

    const landmarks = makeLandmarks();
    landmarks[3] = { x: NaN, y: 0, z: 0 };
    const badFinite = [{ normalizedLandmarks: landmarks, capturedAt: Date.now() }];
    await expect(savePersonalizedGesture({ name: "Busy", meaning: "x", examples: badFinite })).rejects.toThrow();

    expect(await getPersonalizedGestures()).toEqual([]);
  });

  it("rejects saving a gesture with no examples", async () => {
    await expect(savePersonalizedGesture({ name: "Busy", meaning: "x", examples: [] })).rejects.toThrow();
    expect(await getPersonalizedGestures()).toEqual([]);
  });
});

describe("2. add multiple examples to one gesture", () => {
  it("saving with several examples upfront stores all of them under one gesture", async () => {
    const saved = await savePersonalizedGesture({ name: "Busy", meaning: "x", examples: makeExamples(5) });
    expect(saved.examples).toHaveLength(5);
    const reloaded = await getPersonalizedGesture(saved.id);
    expect(reloaded?.examples).toHaveLength(5);
  });

  it("appending examples via update grows the SAME gesture's example count without creating a new record", async () => {
    const saved = await savePersonalizedGesture({ name: "Busy", meaning: "x", examples: makeExamples(2) });
    const updated = await updatePersonalizedGesture(saved.id, {
      examples: [...saved.examples, ...makeExamples(3)],
    });

    expect(updated.id).toBe(saved.id); // same gesture, not a new one
    expect(updated.examples).toHaveLength(5);
    expect((await getPersonalizedGestures())).toHaveLength(1); // still exactly one gesture record
  });
});

describe("3/4. retrieve gesture with examples / retrieve examples by gesture id", () => {
  it("getPersonalizedGesture returns exactly one gesture's own examples, not another's", async () => {
    const a = await savePersonalizedGesture({ name: "Busy", meaning: "x", examples: makeExamples(2) });
    const b = await savePersonalizedGesture({ name: "Later", meaning: "y", examples: makeExamples(3) });

    const reloadedA = await getPersonalizedGesture(a.id);
    const reloadedB = await getPersonalizedGesture(b.id);
    expect(reloadedA?.examples).toHaveLength(2);
    expect(reloadedB?.examples).toHaveLength(3);

    // Cross-check directly against the low-level index too.
    expect(await getExamplesByGestureId(a.id)).toHaveLength(2);
    expect(await getExamplesByGestureId(b.id)).toHaveLength(3);
  });

  it("getPersonalizedGesture returns null for an id that doesn't exist", async () => {
    expect(await getPersonalizedGesture("missing")).toBeNull();
  });
});

describe("5. update gesture", () => {
  it("updates a gesture's fields and refreshes updatedAt while preserving createdAt", async () => {
    const saved = await savePersonalizedGesture({ name: "Busy", meaning: "I'm busy right now", examples: makeExamples() });
    const originalCreatedAt = saved.createdAt;

    await new Promise((resolve) => setTimeout(resolve, 5));
    const updated = await updatePersonalizedGesture(saved.id, { meaning: "Please wait" });

    expect(updated.id).toBe(saved.id);
    expect(updated.meaning).toBe("Please wait");
    expect(updated.createdAt).toBe(originalCreatedAt);
    expect(updated.updatedAt).toBeGreaterThan(originalCreatedAt);
  });

  it("throws when updating a gesture that doesn't exist", async () => {
    await expect(updatePersonalizedGesture("missing-id", { meaning: "x" })).rejects.toThrow();
  });

  it("enables and disables a gesture via setPersonalizedGestureEnabled", async () => {
    const saved = await savePersonalizedGesture({ name: "Busy", meaning: "I'm busy right now", examples: makeExamples() });
    const disabled = await setPersonalizedGestureEnabled(saved.id, false);
    expect(disabled.enabled).toBe(false);
    const reEnabled = await setPersonalizedGestureEnabled(saved.id, true);
    expect(reEnabled.enabled).toBe(true);
  });
});

describe("6. delete gesture", () => {
  it("deletes a gesture and its examples (no orphaned example records)", async () => {
    const saved = await savePersonalizedGesture({ name: "Busy", meaning: "I'm busy right now", examples: makeExamples(3) });
    await deletePersonalizedGesture(saved.id);
    expect(await getPersonalizedGestures()).toEqual([]);
    expect(await getExamplesByGestureId(saved.id)).toEqual([]); // orphan check at the DB layer
  });

  it("deleting a non-existent id is a no-op, not an error", async () => {
    await expect(deletePersonalizedGesture("missing-id")).resolves.toBeUndefined();
  });

  it("saving/updating/deleting one gesture never disturbs unrelated stored gestures", async () => {
    const first = await savePersonalizedGesture({ name: "Busy", meaning: "I'm busy right now", examples: makeExamples() });
    const second = await savePersonalizedGesture({ name: "Later", meaning: "Talk to you later", examples: makeExamples() });

    await updatePersonalizedGesture(first.id, { meaning: "Do not disturb" });

    const all = await getPersonalizedGestures();
    const untouchedSecond = all.find((gesture) => gesture.id === second.id);
    expect(untouchedSecond).toEqual(second);
    expect(all).toHaveLength(2);
  });
});

describe("7/8. unique IDs", () => {
  it("7. every saved gesture gets a unique id", async () => {
    const a = await savePersonalizedGesture({ name: "super", meaning: "x", examples: makeExamples() });
    const b = await savePersonalizedGesture({ name: "super", meaning: "x", examples: makeExamples() });
    expect(a.id).not.toBe(b.id);
  });

  it("8. every example gets a unique id at the storage layer", async () => {
    const saved = await savePersonalizedGesture({ name: "Busy", meaning: "x", examples: makeExamples(5) });
    const records = await getExamplesByGestureId(saved.id);
    const ids = new Set(records.map((r) => r.id));
    expect(ids.size).toBe(5); // all distinct
  });
});

describe("9. duplicate gesture names are allowed", () => {
  it("two separate gestures can both be named 'super' and both persist independently", async () => {
    const a = await savePersonalizedGesture({ name: "super", meaning: "meaning A", examples: makeExamples(5) });
    const b = await savePersonalizedGesture({ name: "super", meaning: "meaning B", examples: makeExamples(5) });
    const c = await savePersonalizedGesture({ name: "super", meaning: "meaning C", examples: makeExamples(5) });

    const all = await getPersonalizedGestures();
    expect(all).toHaveLength(3);
    expect(all.every((g) => g.name === "super")).toBe(true);
    expect(new Set(all.map((g) => g.id)).size).toBe(3); // distinct ids despite identical names
    expect(all.map((g) => g.meaning).sort()).toEqual(["meaning A", "meaning B", "meaning C"]);
    void a;
    void b;
    void c;
  });
});

describe("11/12/13. migration from chrome.storage.local", () => {
  function legacyGesture(overrides: Partial<PersonalizedGesture> = {}): PersonalizedGesture {
    const now = Date.now();
    return {
      id: `legacy-${Math.random().toString(36).slice(2, 8)}`,
      name: "Busy",
      meaning: "I'm busy",
      examples: makeExamples(5),
      enabled: true,
      createdAt: now,
      updatedAt: now,
      ...overrides,
    };
  }

  it("11. migrates legacy chrome.storage.local gestures into IndexedDB on first read", async () => {
    const legacy = legacyGesture();
    chromeStorage.store[PERSONALIZED_GESTURES_STORAGE_KEY] = [legacy];

    const gestures = await getPersonalizedGestures();
    expect(gestures).toHaveLength(1);
    expect(gestures[0].id).toBe(legacy.id);
    expect(gestures[0].name).toBe("Busy");
    expect(gestures[0].examples).toHaveLength(5);

    // Confirms it actually landed in IndexedDB, not just re-read from
    // chrome.storage.local each time.
    const dbRecords = await getAllGestureRecords();
    expect(dbRecords.map((r) => r.id)).toContain(legacy.id);
  });

  it("12. migration is idempotent -- running it twice does not duplicate records", async () => {
    const legacy = legacyGesture();
    chromeStorage.store[PERSONALIZED_GESTURES_STORAGE_KEY] = [legacy];

    await getPersonalizedGestures(); // triggers migration
    _resetMigrationStateForTests(); // simulate a fresh page load re-checking the (now-set) flag
    await getPersonalizedGestures(); // must see the flag and skip re-migrating

    const dbRecords = await getAllGestureRecords();
    expect(dbRecords.filter((r) => r.id === legacy.id)).toHaveLength(1);
    const exampleRecords = await getExamplesByGestureId(legacy.id);
    expect(exampleRecords).toHaveLength(5); // not duplicated to 10
  });

  it("12b. migration is safe to re-run even without the flag (per-gesture existence check)", async () => {
    const legacy = legacyGesture();
    chromeStorage.store[PERSONALIZED_GESTURES_STORAGE_KEY] = [legacy];

    await getPersonalizedGestures();
    // Simulate the flag somehow not having been persisted yet, forcing the
    // migration routine to run again from scratch.
    delete chromeStorage.store["personalizedGesturesDbMigrationV1"];
    _resetMigrationStateForTests();
    await getPersonalizedGestures();

    const dbRecords = await getAllGestureRecords();
    expect(dbRecords.filter((r) => r.id === legacy.id)).toHaveLength(1);
    expect(await getExamplesByGestureId(legacy.id)).toHaveLength(5);
  });

  it("13. multiple legacy 'super' records survive migration as separate gestures, not merged", async () => {
    const superA = legacyGesture({ id: "legacy-super-a", name: "super", meaning: "meaning A" });
    const superB = legacyGesture({ id: "legacy-super-b", name: "super", meaning: "meaning B" });
    const superC = legacyGesture({ id: "legacy-super-c", name: "super", meaning: "meaning C" });
    chromeStorage.store[PERSONALIZED_GESTURES_STORAGE_KEY] = [superA, superB, superC];

    const gestures = await getPersonalizedGestures();
    expect(gestures).toHaveLength(3);
    expect(gestures.map((g) => g.id).sort()).toEqual(["legacy-super-a", "legacy-super-b", "legacy-super-c"]);
    expect(gestures.every((g) => g.name === "super")).toBe(true);
  });

  it("migration tolerates malformed legacy entries without aborting the whole migration", async () => {
    const good = legacyGesture({ id: "legacy-good" });
    chromeStorage.store[PERSONALIZED_GESTURES_STORAGE_KEY] = [
      good,
      { id: "bad", name: "" }, // missing/invalid fields
      null,
      "garbage",
    ];

    const gestures = await getPersonalizedGestures();
    expect(gestures).toHaveLength(1);
    expect(gestures[0].id).toBe("legacy-good");
  });

  it("migration never modifies or clears the original chrome.storage.local record", async () => {
    const legacy = legacyGesture();
    chromeStorage.store[PERSONALIZED_GESTURES_STORAGE_KEY] = [legacy];

    await getPersonalizedGestures();

    expect(chromeStorage.store[PERSONALIZED_GESTURES_STORAGE_KEY]).toEqual([legacy]);
  });

  it("new gestures saved after migration coexist with migrated ones", async () => {
    const legacy = legacyGesture({ id: "legacy-x", name: "Old" });
    chromeStorage.store[PERSONALIZED_GESTURES_STORAGE_KEY] = [legacy];

    await getPersonalizedGestures(); // migrates "Old"
    await savePersonalizedGesture({ name: "New", meaning: "y", examples: makeExamples() });

    const all = await getPersonalizedGestures();
    expect(all.map((g) => g.name).sort()).toEqual(["New", "Old"]);
  });

  it("Phase 9.2: a failed migration attempt does not permanently poison future getPersonalizedGestures() calls", async () => {
    // Same class of regression as personalizedGesturesDb.test.ts's
    // "failed open() does not permanently poison" test, one layer up: if
    // ensureMigrated()'s memoized promise stayed rejected forever after one
    // failure, EVERY future getPersonalizedGestures() call (and therefore
    // every live reload()) would reject forever too.
    type SimpleStorageGet = (key: string) => Promise<Record<string, unknown>>;
    let failFirstCall = true;
    const realGet = chrome.storage.local.get as unknown as SimpleStorageGet;
    (chrome.storage.local as unknown as { get: SimpleStorageGet }).get = async (key: string) => {
      if (failFirstCall) {
        failFirstCall = false;
        throw new Error("simulated chrome.storage.local failure");
      }
      return realGet(key);
    };

    await expect(getPersonalizedGestures()).rejects.toThrow(/simulated chrome.storage.local failure/);

    // The retry (a later call, e.g. from a subsequent recognition
    // activation) must actually succeed, not reject again from a
    // permanently-poisoned memoized promise.
    const saved = await savePersonalizedGesture({ name: "super", meaning: "x", examples: makeExamples(1) });
    const result = await getPersonalizedGestures();
    expect(result.map((g) => g.id)).toContain(saved.id);
  });
});

describe("14. validation reads real data through the service layer from IndexedDB", () => {
  it("validatePersonalizedGestures(await getPersonalizedGestures()) reflects gestures saved via the new IndexedDB-backed service", async () => {
    await savePersonalizedGesture({ name: "super", meaning: "meaning A", examples: makeExamples(5) });
    await savePersonalizedGesture({ name: "super", meaning: "meaning B", examples: makeExamples(5) });

    const report = validatePersonalizedGestures(await getPersonalizedGestures());

    expect(report.gestureCount).toBe(2);
    expect(report.gestures.map((g) => g.displayName).sort()).toEqual(["super #1", "super #2"]);
  });
});

describe("Phase 8.5: mergePersonalizedGestures", () => {
  it("1. merges two gestures: source examples move onto the target, source record is deleted", async () => {
    const target = await savePersonalizedGesture({ name: "super", meaning: "x", examples: makeExamples(3) });
    const source = await savePersonalizedGesture({ name: "super", meaning: "x", examples: makeExamples(2) });

    const result = await mergePersonalizedGestures([source.id], target.id);

    expect(result.targetGestureId).toBe(target.id);
    expect(result.examplesBefore).toBe(3);
    expect(result.validExamplesMerged).toBe(2);
    expect(result.malformedExamplesSkipped).toBe(0);
    expect(result.finalExampleCount).toBe(5);
    expect(result.deletedSourceGestureIds).toEqual([source.id]);

    expect(await getPersonalizedGesture(source.id)).toBeNull();
    const merged = await getPersonalizedGesture(target.id);
    expect(merged?.examples).toHaveLength(5);
  });

  it("2. merges four gestures into one target (the reported real-world scenario)", async () => {
    const canonical = await savePersonalizedGesture({ name: "super", meaning: "x", examples: makeExamples(12) });
    const s1 = await savePersonalizedGesture({ name: "super", meaning: "x", examples: makeExamples(22) });
    const s2 = await savePersonalizedGesture({ name: "super", meaning: "x", examples: makeExamples(14) });
    const s3 = await savePersonalizedGesture({ name: "super", meaning: "x", examples: makeExamples(6) });

    const result = await mergePersonalizedGestures([s1.id, s2.id, s3.id], canonical.id);

    expect(result.finalExampleCount).toBe(54); // 12 + 22 + 14 + 6
    expect(await getPersonalizedGestures()).toHaveLength(1);
    for (const id of [s1.id, s2.id, s3.id]) {
      expect(await getPersonalizedGesture(id)).toBeNull();
    }
  });

  it("3. preserves ALL structurally valid examples -- no distance/confidence/similarity filtering", async () => {
    // Two sources whose examples are geometrically identical to the
    // target's (i.e. maximally "similar" / "duplicate-looking") -- must
    // still all be retained, since only structural validity gates removal.
    const identicalExamples = makeExamples(3);
    const target = await savePersonalizedGesture({ name: "super", meaning: "x", examples: identicalExamples });
    const source = await savePersonalizedGesture({ name: "super", meaning: "x", examples: identicalExamples });

    const result = await mergePersonalizedGestures([source.id], target.id);

    expect(result.validExamplesMerged).toBe(3);
    expect(result.finalExampleCount).toBe(6);
  });

  it("4/5/6. preserves example IDs, normalizedLandmarks, and capturedAt exactly, reassigning only gestureId", async () => {
    const target = await savePersonalizedGesture({ name: "super", meaning: "x", examples: makeExamples(1) });
    const source = await savePersonalizedGesture({ name: "super", meaning: "x", examples: makeExamples(2) });
    const sourceExampleRecordsBefore = await getExamplesByGestureId(source.id);

    await mergePersonalizedGestures([source.id], target.id);

    for (const original of sourceExampleRecordsBefore) {
      const stored = await getExampleRecord(original.id);
      expect(stored).toBeDefined();
      expect(stored?.id).toBe(original.id); // 4. example ID preserved
      expect(stored?.normalizedLandmarks).toEqual(original.normalizedLandmarks); // 5. landmarks preserved exactly
      expect(stored?.capturedAt).toBe(original.capturedAt); // 6. capturedAt preserved exactly
      expect(stored?.gestureId).toBe(target.id); // 7. reassigned to target
    }
  });

  it("8. deletes source gesture records only after a successful merge", async () => {
    const target = await savePersonalizedGesture({ name: "super", meaning: "x", examples: makeExamples(1) });
    const source = await savePersonalizedGesture({ name: "super", meaning: "x", examples: makeExamples(1) });

    await mergePersonalizedGestures([source.id], target.id);

    expect((await getAllGestureRecords()).map((r) => r.id)).not.toContain(source.id);
  });

  it("9. does not delete source records if the merge fails before verification", async () => {
    const target = await savePersonalizedGesture({ name: "super", meaning: "x", examples: makeExamples(1) });
    // Nonexistent target forces a failure path before any source is touched.
    await expect(mergePersonalizedGestures(["missing-source"], target.id)).rejects.toThrow(/source gesture not found/i);

    // The (real, existing) target must be completely untouched.
    expect(await getPersonalizedGesture(target.id)).toMatchObject({ id: target.id });
    expect((await getExamplesByGestureId(target.id))).toHaveLength(1);
  });

  it("10. a duplicate example ID between target and source is handled safely (given a fresh id, not overwritten)", async () => {
    const target = await savePersonalizedGesture({ name: "super", meaning: "x", examples: makeExamples(1) });
    const targetExample = (await getExamplesByGestureId(target.id))[0];

    const source = await savePersonalizedGesture({ name: "super", meaning: "x", examples: makeExamples(1) });
    const sourceExample = (await getExamplesByGestureId(source.id))[0];

    // Force an id collision: give the source's example the SAME id as the
    // target's, but with clearly different content, so the test can prove
    // the target's original example was never clobbered.
    await putExampleRecord({ ...sourceExample, id: targetExample.id, gestureId: source.id });

    const result = await mergePersonalizedGestures([source.id], target.id);

    expect(result.finalExampleCount).toBe(2); // both kept, not collapsed into one
    const finalExamples = await getExamplesByGestureId(target.id);
    expect(new Set(finalExamples.map((e) => e.id)).size).toBe(2); // no duplicate ids
    // The target's original example is still intact under its original id.
    const stillThere = await getExampleRecord(targetExample.id);
    expect(stillThere?.normalizedLandmarks).toEqual(targetExample.normalizedLandmarks);
  });

  it("11. throws when the target gesture doesn't exist", async () => {
    const source = await savePersonalizedGesture({ name: "super", meaning: "x", examples: makeExamples(1) });
    await expect(mergePersonalizedGestures([source.id], "missing-target")).rejects.toThrow(/target gesture not found/i);
    // Source must survive an aborted merge.
    expect(await getPersonalizedGesture(source.id)).not.toBeNull();
  });

  it("12. throws when a source gesture doesn't exist", async () => {
    const target = await savePersonalizedGesture({ name: "super", meaning: "x", examples: makeExamples(1) });
    await expect(mergePersonalizedGestures(["missing-source"], target.id)).rejects.toThrow(/source gesture not found/i);
  });

  it("13. throws when the target is also listed as a source", async () => {
    const target = await savePersonalizedGesture({ name: "super", meaning: "x", examples: makeExamples(1) });
    await expect(mergePersonalizedGestures([target.id], target.id)).rejects.toThrow(/cannot also be/i);
  });

  it("14. malformed source examples are skipped (not merged) without failing the whole operation", async () => {
    const target = await savePersonalizedGesture({ name: "super", meaning: "x", examples: makeExamples(1) });
    const source = await savePersonalizedGesture({ name: "super", meaning: "x", examples: makeExamples(2) });

    // Corrupt one of the source's stored examples directly at the DB layer
    // (bypassing the service's own write-time validation) to simulate
    // pre-existing malformed data.
    const sourceExamples = await getExamplesByGestureId(source.id);
    await putExampleRecord({ ...sourceExamples[0], normalizedLandmarks: sourceExamples[0].normalizedLandmarks.slice(0, 5) });

    const result = await mergePersonalizedGestures([source.id], target.id);

    expect(result.malformedExamplesSkipped).toBe(1);
    expect(result.validExamplesMerged).toBe(1);
    expect(result.finalExampleCount).toBe(2); // 1 original + 1 valid merged
  });

  it("15. same names can coexist before an explicit merge is requested", async () => {
    await savePersonalizedGesture({ name: "super", meaning: "a", examples: makeExamples(1) });
    await savePersonalizedGesture({ name: "super", meaning: "b", examples: makeExamples(1) });
    const all = await getPersonalizedGestures();
    expect(all).toHaveLength(2);
    expect(all.every((g) => g.name === "super")).toBe(true);
  });

  it("16. explicit merge works even when names are identical (identity is id, not name)", async () => {
    const target = await savePersonalizedGesture({ name: "super", meaning: "x", examples: makeExamples(1) });
    const source = await savePersonalizedGesture({ name: "super", meaning: "x", examples: makeExamples(1) });
    await expect(mergePersonalizedGestures([source.id], target.id)).resolves.toBeTruthy();
  });

  it("17. validation reads the final merged record correctly -- no more duplicate-name pairs", async () => {
    const canonical = await savePersonalizedGesture({ name: "super", meaning: "x", examples: makeExamples(12) });
    const s1 = await savePersonalizedGesture({ name: "super", meaning: "x", examples: makeExamples(22) });
    const s2 = await savePersonalizedGesture({ name: "super", meaning: "x", examples: makeExamples(14) });
    const s3 = await savePersonalizedGesture({ name: "super", meaning: "x", examples: makeExamples(6) });

    await mergePersonalizedGestures([s1.id, s2.id, s3.id], canonical.id);

    const report = validatePersonalizedGestures(await getPersonalizedGestures());
    expect(report.gestureCount).toBe(1);
    expect(report.gestures[0].displayName).toBe("super"); // no "#1" suffix -- only one "super" left
    expect(report.gestures[0].exampleCount).toBe(54);
    expect(report.crossGesturePairs).toEqual([]); // no more super <-> super
  });

  it("18. existing migration tests continue passing alongside merge (no interference)", async () => {
    const legacy: PersonalizedGesture = {
      id: "legacy-1",
      name: "Old",
      meaning: "x",
      examples: makeExamples(2),
      enabled: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    chromeStorage.store[PERSONALIZED_GESTURES_STORAGE_KEY] = [legacy];

    const migrated = await getPersonalizedGestures(); // triggers migration
    expect(migrated.map((g) => g.id)).toContain("legacy-1");

    const target = await savePersonalizedGesture({ name: "super", meaning: "x", examples: makeExamples(1) });
    const source = await savePersonalizedGesture({ name: "super", meaning: "x", examples: makeExamples(1) });
    await mergePersonalizedGestures([source.id], target.id);

    const finalGestures = await getPersonalizedGestures();
    expect(finalGestures.map((g) => g.id).sort()).toEqual(["legacy-1", target.id].sort());
  });

  it("an aborted merge (one of several sources missing) leaves the target and any valid sources completely untouched", async () => {
    // All sources are existence-checked before any example is written, so
    // a missing source aborts before the write phase starts -- this
    // verifies that guarantee end-to-end: nothing on the target or the
    // OTHER (valid) source changes as a side effect of the failed attempt.
    const target = await savePersonalizedGesture({ name: "super", meaning: "x", examples: makeExamples(1) });
    const validSource = await savePersonalizedGesture({ name: "super", meaning: "x", examples: makeExamples(2) });
    const originalTargetExamples = await getExamplesByGestureId(target.id);

    await expect(mergePersonalizedGestures(["missing", validSource.id], target.id)).rejects.toThrow(/source gesture not found/i);

    expect(await getExamplesByGestureId(target.id)).toEqual(originalTargetExamples);
    expect(await getExamplesByGestureId(validSource.id)).toHaveLength(2);
    expect(await getPersonalizedGesture(validSource.id)).not.toBeNull(); // not deleted
  });
});

describe("Phase 9.1 diagnostic: getPersonalizedGestures() freshness", () => {
  it("always reflects the current stored state -- a gesture saved AFTER an earlier read is visible on the next read", async () => {
    // This isolates one candidate explanation for "live personalized
    // recognition does not appear despite valid stored data": is the
    // SERVICE/DATA layer serving stale results, or is a CALLER (offscreen.ts)
    // choosing to reuse an old snapshot instead of re-reading? This test
    // proves it is not the former -- getPersonalizedGestures() has no
    // internal caching and always reflects IndexedDB's current contents.
    const before = await getPersonalizedGestures();
    expect(before).toHaveLength(0);

    const saved = await savePersonalizedGesture({ name: "super", meaning: "super", examples: makeExamples(1) });

    const after = await getPersonalizedGestures();
    expect(after).toHaveLength(1);
    expect(after[0].id).toBe(saved.id);
    expect(after[0].examples).toHaveLength(1);
  });

  it("a snapshot captured before a save does NOT retroactively include a gesture saved afterward (demonstrates why a one-time snapshot goes stale)", async () => {
    // Simulates offscreen.ts's actual pattern (see the Phase 9.1 report):
    // `personalizedGestures` is captured once when hand tracking starts and
    // reused for every subsequent frame's match, never re-fetched unless
    // the hand tracker itself reloads. If a gesture is recorded (via
    // record.html, a separate document/tab writing directly to IndexedDB)
    // WHILE the offscreen document's hand tracker is already loaded, the
    // in-memory snapshot below is exactly what a live frame would be
    // matched against -- and it is provably stale by construction, not
    // because getPersonalizedGestures() itself is broken (see the test
    // above).
    const snapshotBeforeRecording = await getPersonalizedGestures();
    expect(snapshotBeforeRecording).toHaveLength(0);

    await savePersonalizedGesture({ name: "super", meaning: "super", examples: makeExamples(1) });

    expect(snapshotBeforeRecording).toHaveLength(0); // the array itself was never mutated
    const freshRead = await getPersonalizedGestures();
    expect(freshRead).toHaveLength(1);
  });
});

describe("Phase 10: localizedMeanings round-trips through the storage layer", () => {
  it("savePersonalizedGesture -> getPersonalizedGestures preserves localizedMeanings", async () => {
    const saved = await savePersonalizedGesture({
      name: "super",
      meaning: "Great!",
      localizedMeanings: { "hi-IN": "बहुत बढ़िया!", "te-IN": "చాలా బాగుంది!" },
      examples: makeExamples(1),
    });
    expect(saved.localizedMeanings).toEqual({ "hi-IN": "बहुत बढ़िया!", "te-IN": "చాలా బాగుంది!" });

    const reread = await getPersonalizedGesture(saved.id);
    expect(reread?.localizedMeanings).toEqual({ "hi-IN": "बहुत बढ़िया!", "te-IN": "చాలా బాగుంది!" });
  });

  it("a gesture saved with no localizedMeanings round-trips as undefined (real existing data is unaffected)", async () => {
    const saved = await savePersonalizedGesture({ name: "super", meaning: "Great!", examples: makeExamples(1) });
    expect(saved.localizedMeanings).toBeUndefined();
    const reread = await getPersonalizedGesture(saved.id);
    expect(reread?.localizedMeanings).toBeUndefined();
  });

  it("updatePersonalizedGesture can set localizedMeanings on a gesture that didn't have any", async () => {
    const saved = await savePersonalizedGesture({ name: "super", meaning: "Great!", examples: makeExamples(1) });
    const updated = await updatePersonalizedGesture(saved.id, { localizedMeanings: { "hi-IN": "बहुत बढ़िया!" } });
    expect(updated.localizedMeanings).toEqual({ "hi-IN": "बहुत बढ़िया!" });
    expect((await getPersonalizedGesture(saved.id))?.localizedMeanings).toEqual({ "hi-IN": "बहुत बढ़िया!" });
  });
});
