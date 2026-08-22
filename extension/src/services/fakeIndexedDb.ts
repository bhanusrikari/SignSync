/**
 * Minimal in-memory fake of the `indexedDB` global surface
 * personalizedGesturesDb.ts actually uses (open/onupgradeneeded,
 * createObjectStore/createIndex, transaction/objectStore,
 * put/get/getAll/delete, index().getAll()). Test-only -- mirrors the same
 * pattern already used for the chrome.storage.local fake in
 * services/personalizedGestures.test.ts. Not a *.test.ts file itself, so
 * Vitest's `include` glob never picks it up as a test.
 *
 * Data persists across open() calls within one installFakeIndexedDb() call
 * (matching real IndexedDB's persistent-per-database-name behavior), so a
 * test can call _resetConnectionForTests() to simulate a fresh page
 * reconnecting to the same on-disk database, exactly like the real
 * scenario an extension's separate pages (record.html, validate.html)
 * reconnect to.
 */
type Listener = (() => void) | null;

class FakeRequest<T> {
  onsuccess: Listener = null;
  onerror: Listener = null;
  result: T = undefined as unknown as T;
  error: unknown = null;

  succeed(result: T): void {
    this.result = result;
    queueMicrotask(() => this.onsuccess?.());
  }

  fail(error: unknown): void {
    this.error = error;
    queueMicrotask(() => this.onerror?.());
  }
}

interface FakeStoreData {
  keyPath: string;
  records: Map<string, unknown>;
  indexes: Map<string, string>; // indexName -> keyPath on the record
}

class FakeObjectStore {
  constructor(private readonly data: FakeStoreData) {}

  put(value: Record<string, unknown>): FakeRequest<undefined> {
    const request = new FakeRequest<undefined>();
    this.data.records.set(String(value[this.data.keyPath]), value);
    request.succeed(undefined);
    return request;
  }

  get(key: string): FakeRequest<unknown> {
    const request = new FakeRequest<unknown>();
    request.succeed(this.data.records.get(key));
    return request;
  }

  getAll(): FakeRequest<unknown[]> {
    const request = new FakeRequest<unknown[]>();
    request.succeed([...this.data.records.values()]);
    return request;
  }

  delete(key: string): FakeRequest<undefined> {
    const request = new FakeRequest<undefined>();
    this.data.records.delete(key);
    request.succeed(undefined);
    return request;
  }

  createIndex(name: string, keyPath: string): void {
    this.data.indexes.set(name, keyPath);
  }

  index(name: string) {
    const keyPath = this.data.indexes.get(name);
    return {
      getAll: (value: string): FakeRequest<unknown[]> => {
        const request = new FakeRequest<unknown[]>();
        const results = [...this.data.records.values()].filter(
          (record) => (record as Record<string, unknown>)[keyPath as string] === value,
        );
        request.succeed(results);
        return request;
      },
    };
  }
}

class FakeTransaction {
  constructor(private readonly stores: Map<string, FakeStoreData>) {}

  objectStore(name: string): FakeObjectStore {
    const data = this.stores.get(name);
    if (!data) throw new Error(`Fake IndexedDB: no such object store "${name}"`);
    return new FakeObjectStore(data);
  }
}

class FakeDatabase {
  stores = new Map<string, FakeStoreData>();

  objectStoreNames = {
    contains: (name: string): boolean => this.stores.has(name),
  };

  createObjectStore(name: string, options: { keyPath: string }): FakeObjectStore {
    const data: FakeStoreData = { keyPath: options.keyPath, records: new Map(), indexes: new Map() };
    this.stores.set(name, data);
    return new FakeObjectStore(data);
  }

  transaction(_storeNames: string | string[], _mode: string): FakeTransaction {
    return new FakeTransaction(this.stores);
  }
}

/** Installs a fake `indexedDB` global. Each named database persists for
 *  the lifetime of this fake (i.e. across every open() call until the test
 *  file's module state is reset), matching real IndexedDB's
 *  per-database-name persistence. */
export function installFakeIndexedDb(): void {
  const databases = new Map<string, FakeDatabase>();

  (globalThis as unknown as { indexedDB: unknown }).indexedDB = {
    open(name: string, _version: number) {
      const request = new FakeRequest<FakeDatabase>();
      const isNew = !databases.has(name);
      const db = databases.get(name) ?? new FakeDatabase();
      if (isNew) databases.set(name, db);

      queueMicrotask(() => {
        // Real IDBOpenDBRequest already has `.result` set to the (possibly
        // still-upgrading) database by the time onupgradeneeded fires --
        // production code reads `request.result` from inside that handler,
        // so it must be set here first, not only via succeed() afterward.
        request.result = db;
        if (isNew) {
          (request as unknown as { onupgradeneeded: Listener }).onupgradeneeded?.();
        }
        request.succeed(db);
      });

      return request as unknown as IDBOpenDBRequest;
    },
  };
}
