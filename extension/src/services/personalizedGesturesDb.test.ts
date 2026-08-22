import { beforeEach, describe, expect, it } from "vitest";
import { installFakeIndexedDb } from "./fakeIndexedDb";
import {
  _resetConnectionForTests,
  deleteExamplesByGestureId,
  deleteGestureRecord,
  getAllGestureRecords,
  getExamplesByGestureId,
  getGestureRecord,
  openPersonalizedGesturesDb,
  putExampleRecord,
  putGestureRecord,
} from "./personalizedGesturesDb";
import type { StoredExampleRecord, StoredGestureRecord } from "./personalizedGesturesDb";
import type { Point3D } from "@/ai/gestureTypes";

function makeLandmarks(): Point3D[] {
  return Array.from({ length: 21 }, (_, i) => ({ x: i * 0.01, y: i * 0.02, z: 0 }));
}

function makeGestureRecord(overrides: Partial<StoredGestureRecord> = {}): StoredGestureRecord {
  const now = Date.now();
  return { id: "g1", name: "Busy", meaning: "I'm busy", enabled: true, createdAt: now, updatedAt: now, ...overrides };
}

function makeExampleRecord(overrides: Partial<StoredExampleRecord> = {}): StoredExampleRecord {
  return { id: "e1", gestureId: "g1", normalizedLandmarks: makeLandmarks(), capturedAt: Date.now(), ...overrides };
}

beforeEach(() => {
  _resetConnectionForTests();
  installFakeIndexedDb();
});

describe("personalizedGesturesDb", () => {
  it("puts and retrieves a gesture record", async () => {
    const record = makeGestureRecord();
    await putGestureRecord(record);
    expect(await getGestureRecord(record.id)).toEqual(record);
  });

  it("returns undefined for a gesture id that doesn't exist", async () => {
    expect(await getGestureRecord("missing")).toBeUndefined();
  });

  it("getAllGestureRecords returns every stored gesture", async () => {
    await putGestureRecord(makeGestureRecord({ id: "g1" }));
    await putGestureRecord(makeGestureRecord({ id: "g2", name: "Later" }));
    const all = await getAllGestureRecords();
    expect(all).toHaveLength(2);
    expect(all.map((g) => g.id).sort()).toEqual(["g1", "g2"]);
  });

  it("deletes a gesture record", async () => {
    await putGestureRecord(makeGestureRecord({ id: "g1" }));
    await deleteGestureRecord("g1");
    expect(await getGestureRecord("g1")).toBeUndefined();
  });

  it("puts and retrieves example records by gestureId via the index", async () => {
    await putExampleRecord(makeExampleRecord({ id: "e1", gestureId: "g1" }));
    await putExampleRecord(makeExampleRecord({ id: "e2", gestureId: "g1" }));
    await putExampleRecord(makeExampleRecord({ id: "e3", gestureId: "g2" }));

    const g1Examples = await getExamplesByGestureId("g1");
    expect(g1Examples.map((e) => e.id).sort()).toEqual(["e1", "e2"]);

    const g2Examples = await getExamplesByGestureId("g2");
    expect(g2Examples.map((e) => e.id)).toEqual(["e3"]);
  });

  it("deleteExamplesByGestureId removes only that gesture's examples", async () => {
    await putExampleRecord(makeExampleRecord({ id: "e1", gestureId: "g1" }));
    await putExampleRecord(makeExampleRecord({ id: "e2", gestureId: "g1" }));
    await putExampleRecord(makeExampleRecord({ id: "e3", gestureId: "g2" }));

    await deleteExamplesByGestureId("g1");

    expect(await getExamplesByGestureId("g1")).toEqual([]);
    expect(await getExamplesByGestureId("g2")).toHaveLength(1);
  });

  it("data persists across a fresh connection (simulates reopening the extension)", async () => {
    await putGestureRecord(makeGestureRecord({ id: "g1" }));
    await putExampleRecord(makeExampleRecord({ id: "e1", gestureId: "g1" }));

    _resetConnectionForTests(); // new "page load" reconnecting to the same DB

    expect(await getGestureRecord("g1")).toBeTruthy();
    expect(await getExamplesByGestureId("g1")).toHaveLength(1);
  });

  it("Phase 9.2: a failed open() does not permanently poison future connection attempts", async () => {
    // Regression test for the "gestureCount=0 forever, even though frames
    // keep ticking" failure mode: previously, if indexedDB.open() ever
    // rejected once, the memoized connection promise stayed rejected for
    // the rest of the page's life, so EVERY future read/write (including
    // every later reload() from an already-running offscreen document)
    // would reject forever, silently degrading to an empty gesture list
    // with no way to recover short of a full page reload.
    let callCount = 0;
    (globalThis as unknown as { indexedDB: unknown }).indexedDB = {
      open() {
        callCount++;
        const request = {
          onsuccess: null as (() => void) | null,
          onerror: null as (() => void) | null,
          onupgradeneeded: null as (() => void) | null,
          result: undefined as unknown,
          error: new Error("simulated indexedDB.open failure"),
        };
        queueMicrotask(() => {
          if (callCount === 1) {
            request.onerror?.();
          } else {
            request.result = { objectStoreNames: { contains: () => true }, transaction: () => ({}) };
            request.onsuccess?.();
          }
        });
        return request as unknown as IDBOpenDBRequest;
      },
    };

    await expect(openPersonalizedGesturesDb()).rejects.toThrow(/simulated indexedDB.open failure/);
    // The NEXT call must be a genuinely fresh attempt (callCount increments
    // to 2), not the same permanently-rejected promise from before.
    await expect(openPersonalizedGesturesDb()).resolves.toBeTruthy();
    expect(callCount).toBe(2);
  });
});
