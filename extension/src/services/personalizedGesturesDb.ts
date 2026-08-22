/**
 * Low-level IndexedDB access for personalized gestures. Owns the database
 * connection, schema (object stores + index), and raw CRUD against them.
 * No domain validation here (see shared/personalizedGestures.ts) and no
 * migration logic (see personalizedGestures.ts) -- this module is purely
 * "how to talk to SignSyncDB."
 *
 * Split into two stores (one gesture -> many examples) rather than
 * embedding examples inside the gesture record, matching the relationship
 * the domain actually has and allowing examples to be queried/updated
 * independently of their parent gesture's metadata.
 */
import type { Point3D } from "@/ai/gestureTypes";
import type { LanguageCode } from "@/types";

export const DB_NAME = "SignSyncDB";
export const DB_VERSION = 1;
export const GESTURES_STORE = "personalizedGestures";
export const EXAMPLES_STORE = "gestureExamples";
export const EXAMPLES_GESTURE_ID_INDEX = "gestureId";

export interface StoredGestureRecord {
  id: string;
  name: string;
  meaning: string;
  /** Optional per-language meaning (Phase 10 Part 9) -- see
   *  PersonalizedGesture.localizedMeanings's doc comment. Absent on every
   *  record written before this field existed; IndexedDB's object stores
   *  are schemaless, so this needed no DB_VERSION bump or migration. */
  localizedMeanings?: Partial<Record<LanguageCode, string>>;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface StoredExampleRecord {
  id: string;
  gestureId: string;
  normalizedLandmarks: Point3D[];
  capturedAt: number;
}

function promisifyRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

let dbPromise: Promise<IDBDatabase> | null = null;

/** Opens (creating/upgrading if needed) the shared SignSyncDB connection.
 *  Memoized per page load -- IndexedDB connections are meant to be reused,
 *  not reopened per operation.
 *
 *  Phase 9.2 hardening: if the open attempt fails, the memoized promise is
 *  cleared (not left as a permanently-rejected value) so the NEXT caller
 *  gets a genuinely fresh connection attempt instead of every future
 *  read/write in this page's lifetime rejecting forever because of one
 *  historical failure. */
export function openPersonalizedGesturesDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(GESTURES_STORE)) {
        db.createObjectStore(GESTURES_STORE, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(EXAMPLES_STORE)) {
        const store = db.createObjectStore(EXAMPLES_STORE, { keyPath: "id" });
        store.createIndex(EXAMPLES_GESTURE_ID_INDEX, "gestureId", { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  }).catch((error: unknown) => {
    dbPromise = null;
    throw error;
  });
  return dbPromise;
}

/** Test-only: drops the memoized connection so a fresh fake indexedDB
 *  installed between tests is actually used. Production code never needs
 *  this -- one page load, one connection. */
export function _resetConnectionForTests(): void {
  dbPromise = null;
}

export async function putGestureRecord(record: StoredGestureRecord): Promise<void> {
  const db = await openPersonalizedGesturesDb();
  const store = db.transaction(GESTURES_STORE, "readwrite").objectStore(GESTURES_STORE);
  await promisifyRequest(store.put(record));
}

export async function getGestureRecord(id: string): Promise<StoredGestureRecord | undefined> {
  const db = await openPersonalizedGesturesDb();
  const store = db.transaction(GESTURES_STORE, "readonly").objectStore(GESTURES_STORE);
  return promisifyRequest(store.get(id));
}

export async function getAllGestureRecords(): Promise<StoredGestureRecord[]> {
  const db = await openPersonalizedGesturesDb();
  const store = db.transaction(GESTURES_STORE, "readonly").objectStore(GESTURES_STORE);
  return promisifyRequest(store.getAll());
}

export async function deleteGestureRecord(id: string): Promise<void> {
  const db = await openPersonalizedGesturesDb();
  const store = db.transaction(GESTURES_STORE, "readwrite").objectStore(GESTURES_STORE);
  await promisifyRequest(store.delete(id));
}

export async function putExampleRecord(record: StoredExampleRecord): Promise<void> {
  const db = await openPersonalizedGesturesDb();
  const store = db.transaction(EXAMPLES_STORE, "readwrite").objectStore(EXAMPLES_STORE);
  await promisifyRequest(store.put(record));
}

/** Single example lookup by its own id -- used by mergePersonalizedGestures()
 *  (see personalizedGestures.ts) to verify a specific reassigned example
 *  landed correctly, distinct from getExamplesByGestureId()'s by-parent
 *  bulk lookup. */
export async function getExampleRecord(id: string): Promise<StoredExampleRecord | undefined> {
  const db = await openPersonalizedGesturesDb();
  const store = db.transaction(EXAMPLES_STORE, "readonly").objectStore(EXAMPLES_STORE);
  return promisifyRequest(store.get(id));
}

/** Deletes a single example by its own id -- used by
 *  mergePersonalizedGestures()'s rollback path to undo a partial write
 *  (an example that was given a fresh id to avoid an id collision, and so
 *  has no prior state to restore -- it must be removed entirely instead). */
export async function deleteExampleRecord(id: string): Promise<void> {
  const db = await openPersonalizedGesturesDb();
  const store = db.transaction(EXAMPLES_STORE, "readwrite").objectStore(EXAMPLES_STORE);
  await promisifyRequest(store.delete(id));
}

export async function getExamplesByGestureId(gestureId: string): Promise<StoredExampleRecord[]> {
  const db = await openPersonalizedGesturesDb();
  const store = db.transaction(EXAMPLES_STORE, "readonly").objectStore(EXAMPLES_STORE);
  return promisifyRequest(store.index(EXAMPLES_GESTURE_ID_INDEX).getAll(gestureId));
}

export async function deleteExamplesByGestureId(gestureId: string): Promise<void> {
  const existing = await getExamplesByGestureId(gestureId);
  const db = await openPersonalizedGesturesDb();
  const store = db.transaction(EXAMPLES_STORE, "readwrite").objectStore(EXAMPLES_STORE);
  await Promise.all(existing.map((example) => promisifyRequest(store.delete(example.id))));
}
