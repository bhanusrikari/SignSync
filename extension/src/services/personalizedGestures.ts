/**
 * CRUD for user-taught personalized gestures. IndexedDB (SignSyncDB, see
 * personalizedGesturesDb.ts) is the source of truth -- one gesture record,
 * many example records, related by gestureId. chrome.storage.local's
 * legacy `signSyncPersonalizedGestures` key is migrated from automatically
 * (once, lazily, idempotently -- see ensureMigrated()) and never modified
 * or deleted afterward, so it stays available as an audit trail / rollback
 * reference.
 *
 * The exported function signatures are unchanged from the
 * chrome.storage.local-only version this replaces -- record.html,
 * validate.html, and any other caller keep working without modification.
 */
import {
  deleteExampleRecord,
  deleteExamplesByGestureId,
  deleteGestureRecord,
  getAllGestureRecords,
  getExampleRecord,
  getExamplesByGestureId,
  getGestureRecord,
  putExampleRecord,
  putGestureRecord,
} from "./personalizedGesturesDb";
import type { StoredExampleRecord, StoredGestureRecord } from "./personalizedGesturesDb";
import {
  PERSONALIZED_GESTURES_STORAGE_KEY,
  generatePersonalizedGestureId,
  isPersonalizedGestureExample,
  isValidPersonalizedGesture,
  sanitizeStoredPersonalizedGestures,
} from "@/shared/personalizedGestures";
import type { PersonalizedGesture, PersonalizedGestureExample } from "@/types";

/** chrome.storage.local flag marking the one-time migration as complete.
 *  Checked/set there (not in IndexedDB) so it survives independently of
 *  the IndexedDB schema itself and is trivially inspectable/resettable via
 *  the same storage the legacy data already lives in. */
const MIGRATION_FLAG_KEY = "personalizedGesturesDbMigrationV1";

function generateExampleId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `pge_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

let migrationPromise: Promise<void> | null = null;

/**
 * One-time migration, chrome.storage.local -> IndexedDB. Idempotent and
 * non-destructive:
 *  - Guarded by MIGRATION_FLAG_KEY: once set, never re-runs (across page
 *    loads/sessions).
 *  - Memoized in-memory (migrationPromise): concurrent calls within one
 *    page load await the same run instead of racing.
 *  - Per-gesture existence check: even if the flag were somehow missing
 *    (or this ran twice before the flag write completed), a gesture id
 *    already present in IndexedDB is skipped entirely -- it and its
 *    examples are never re-inserted or duplicated.
 *  - Multiple legacy records that happen to share a name (e.g. several
 *    separate "super" gestures recorded in separate sessions) are NOT
 *    merged -- each keeps its own id and becomes its own IndexedDB gesture
 *    record, exactly as it was.
 *  - The legacy chrome.storage.local record itself is never written to or
 *    cleared by this function.
 *  - Malformed legacy entries are dropped by sanitizeStoredPersonalizedGestures()
 *    (already the case before this phase) rather than aborting the whole
 *    migration.
 */
/** Phase 9.2 hardening: if runMigration() throws, the memoized promise is
 *  cleared (not left permanently rejected) so the NEXT call gets a genuine
 *  retry instead of every future getPersonalizedGestures() call rejecting
 *  forever because of one historical failure (e.g. a transient
 *  chrome.storage.local or IndexedDB error). */
function ensureMigrated(): Promise<void> {
  if (!migrationPromise) {
    migrationPromise = runMigration().catch((error: unknown) => {
      migrationPromise = null;
      throw error;
    });
  }
  return migrationPromise;
}

async function runMigration(): Promise<void> {
  const flagResult = await chrome.storage.local.get(MIGRATION_FLAG_KEY);
  if (flagResult[MIGRATION_FLAG_KEY] === true) return;

  const stored = await chrome.storage.local.get(PERSONALIZED_GESTURES_STORAGE_KEY);
  const legacyGestures = sanitizeStoredPersonalizedGestures(stored[PERSONALIZED_GESTURES_STORAGE_KEY]);

  for (const gesture of legacyGestures) {
    const existing = await getGestureRecord(gesture.id);
    if (existing) continue; // already migrated -- never duplicate

    await putGestureRecord({
      id: gesture.id,
      name: gesture.name,
      meaning: gesture.meaning,
      localizedMeanings: gesture.localizedMeanings,
      enabled: gesture.enabled,
      createdAt: gesture.createdAt,
      updatedAt: gesture.updatedAt,
    });
    for (const example of gesture.examples) {
      await putExampleRecord({
        id: generateExampleId(),
        gestureId: gesture.id,
        normalizedLandmarks: example.normalizedLandmarks,
        capturedAt: example.capturedAt,
      });
    }
  }

  await chrome.storage.local.set({ [MIGRATION_FLAG_KEY]: true });
}

/** Test-only: clears in-memory migration memoization so each test starts
 *  fresh against its own fake indexedDB/chrome.storage instance. */
export function _resetMigrationStateForTests(): void {
  migrationPromise = null;
}

async function toDomainGesture(record: StoredGestureRecord): Promise<PersonalizedGesture> {
  const examples = await getExamplesByGestureId(record.id);
  return {
    id: record.id,
    name: record.name,
    meaning: record.meaning,
    localizedMeanings: record.localizedMeanings,
    examples: examples.map((example) => ({
      normalizedLandmarks: example.normalizedLandmarks,
      capturedAt: example.capturedAt,
    })),
    enabled: record.enabled,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

/** All stored personalized gestures, with any malformed entries silently
 *  dropped (see isValidPersonalizedGesture). */
export async function getPersonalizedGestures(): Promise<PersonalizedGesture[]> {
  await ensureMigrated();
  const records = await getAllGestureRecords();
  const gestures = await Promise.all(records.map(toDomainGesture));
  const valid = gestures.filter(isValidPersonalizedGesture);
  // TEMPORARY (Phase 9.2 diagnostics): the single source-of-truth read this
  // is -- every other layer (loader, offscreen frame loop) can only ever be
  // as fresh/correct as what THIS call actually returns, so this is where
  // "does IndexedDB even have F85B78" is answered directly, independent of
  // any caching/loading logic above it. Remove once live recognition is
  // confirmed working end to end.
  console.log(
    `[PERS-GESTURE-DEBUG] DB LOAD RESULT count=${valid.length} ` +
      `ids=${valid.map((g) => g.id).join(",")} names=${valid.map((g) => g.name).join(",")} ` +
      `exampleCounts=${valid.map((g) => g.examples.length).join(",")}`,
  );
  return valid;
}

/** Single gesture by id, or null if it doesn't exist (or is malformed).
 *  New in this phase -- purely additive, used by the recording page's
 *  "add more examples to this gesture" mode (see record/App.tsx). */
export async function getPersonalizedGesture(id: string): Promise<PersonalizedGesture | null> {
  await ensureMigrated();
  const record = await getGestureRecord(id);
  if (!record) return null;
  const gesture = await toDomainGesture(record);
  return isValidPersonalizedGesture(gesture) ? gesture : null;
}

/**
 * Creates and persists a new personalized gesture with a fresh id and
 * matching createdAt/updatedAt. Throws if the resulting record fails
 * validation (see isValidPersonalizedGesture) -- invalid data is rejected
 * before it ever reaches storage.
 */
export async function savePersonalizedGesture(input: {
  name: string;
  meaning: string;
  /** Optional per-language meanings (Phase 10 Part 9) -- see
   *  PersonalizedGesture.localizedMeanings's doc comment. No existing
   *  caller (record/App.tsx) passes this yet -- authoring UI is a Remaining
   *  PRD Gap -- but the storage layer supports it for when one exists. */
  localizedMeanings?: PersonalizedGesture["localizedMeanings"];
  examples: PersonalizedGestureExample[];
}): Promise<PersonalizedGesture> {
  await ensureMigrated();
  const now = Date.now();
  const candidate: PersonalizedGesture = {
    id: generatePersonalizedGestureId(),
    name: input.name,
    meaning: input.meaning,
    localizedMeanings: input.localizedMeanings,
    examples: input.examples,
    enabled: true,
    createdAt: now,
    updatedAt: now,
  };
  if (!isValidPersonalizedGesture(candidate)) {
    throw new Error("Cannot save an invalid personalized gesture");
  }

  await putGestureRecord({
    id: candidate.id,
    name: candidate.name,
    meaning: candidate.meaning,
    localizedMeanings: candidate.localizedMeanings,
    enabled: candidate.enabled,
    createdAt: candidate.createdAt,
    updatedAt: candidate.updatedAt,
  });
  for (const example of candidate.examples) {
    await putExampleRecord({
      id: generateExampleId(),
      gestureId: candidate.id,
      normalizedLandmarks: example.normalizedLandmarks,
      capturedAt: example.capturedAt,
    });
  }
  return candidate;
}

/**
 * Applies a partial update to an existing personalized gesture by id.
 * createdAt is always preserved; updatedAt is always refreshed. Passing
 * `examples` REPLACES the gesture's full example set (matching the prior
 * chrome.storage.local-backed semantics) -- callers that want to APPEND
 * examples must first read the existing ones (getPersonalizedGesture) and
 * pass the concatenated array. Throws (without writing) if no gesture with
 * that id exists, or if the resulting record would be invalid.
 */
export async function updatePersonalizedGesture(
  id: string,
  changes: Partial<Pick<PersonalizedGesture, "name" | "meaning" | "localizedMeanings" | "examples" | "enabled">>,
): Promise<PersonalizedGesture> {
  await ensureMigrated();
  const record = await getGestureRecord(id);
  if (!record) {
    throw new Error(`Personalized gesture not found: ${id}`);
  }

  const updatedRecord: StoredGestureRecord = {
    id: record.id,
    name: changes.name ?? record.name,
    meaning: changes.meaning ?? record.meaning,
    localizedMeanings: "localizedMeanings" in changes ? changes.localizedMeanings : record.localizedMeanings,
    enabled: changes.enabled ?? record.enabled,
    createdAt: record.createdAt,
    updatedAt: Date.now(),
  };

  const examples: PersonalizedGestureExample[] = changes.examples
    ? changes.examples
    : (await getExamplesByGestureId(id)).map((example) => ({
        normalizedLandmarks: example.normalizedLandmarks,
        capturedAt: example.capturedAt,
      }));

  const updated: PersonalizedGesture = { ...updatedRecord, examples };
  if (!isValidPersonalizedGesture(updated)) {
    throw new Error("Cannot save an invalid personalized gesture");
  }

  await putGestureRecord(updatedRecord);
  if (changes.examples) {
    await deleteExamplesByGestureId(id);
    for (const example of changes.examples) {
      await putExampleRecord({
        id: generateExampleId(),
        gestureId: id,
        normalizedLandmarks: example.normalizedLandmarks,
        capturedAt: example.capturedAt,
      });
    }
  }

  return updated;
}

/** Removes one personalized gesture (and its examples) by id. A no-op if
 *  the id doesn't exist -- deleting something already gone is not a
 *  failure. */
export async function deletePersonalizedGesture(id: string): Promise<void> {
  await ensureMigrated();
  await deleteExamplesByGestureId(id);
  await deleteGestureRecord(id);
}

/** Convenience wrapper over updatePersonalizedGesture for the enable/disable toggle. */
export async function setPersonalizedGestureEnabled(
  id: string,
  enabled: boolean,
): Promise<PersonalizedGesture> {
  return updatePersonalizedGesture(id, { enabled });
}

// --- Explicit duplicate-record merge (Phase 8.5) --------------------------
// User-initiated only -- never runs automatically, never triggered by
// matching names. See validate/App.tsx's merge UI.

function isValidStoredExampleRecord(record: StoredExampleRecord): boolean {
  return (
    typeof record.id === "string" &&
    record.id.length > 0 &&
    typeof record.gestureId === "string" &&
    record.gestureId.length > 0 &&
    isPersonalizedGestureExample({
      normalizedLandmarks: record.normalizedLandmarks,
      capturedAt: record.capturedAt,
    })
  );
}

function landmarksEqual(a: StoredExampleRecord["normalizedLandmarks"], b: StoredExampleRecord["normalizedLandmarks"]): boolean {
  return a.length === b.length && a.every((point, i) => point.x === b[i].x && point.y === b[i].y && point.z === b[i].z);
}

export interface MergePersonalizedGesturesResult {
  targetGestureId: string;
  targetName: string;
  /** Example count already on the target before the merge. */
  examplesBefore: number;
  /** Structurally valid source examples successfully moved onto the target. */
  validExamplesMerged: number;
  /** Source examples rejected for being structurally malformed (never for
   *  distance/confidence/similarity -- see the Phase 8.5 report). */
  malformedExamplesSkipped: number;
  /** Total examples on the target after the merge (examplesBefore + validExamplesMerged). */
  finalExampleCount: number;
  deletedSourceGestureIds: string[];
}

/**
 * Explicitly merges one or more source gestures' examples into a single
 * target gesture, then deletes the (now-empty) source gesture records.
 * User-initiated ONLY -- this never runs automatically and is never
 * triggered by gestures merely sharing a name (see the Phase 8.5 report's
 * Step 7: name is a label, id is identity, and only an explicit merge
 * changes that).
 *
 * Retains every structurally valid source example UNCHANGED (same id,
 * landmarks, capturedAt -- only `gestureId` is reassigned); rejects only
 * examples that fail the existing structural validation
 * (isPersonalizedGestureExample -- wrong landmark count, non-finite
 * coordinates, missing id/gestureId). Deliberately does NOT filter by
 * distance, confidence, or similarity to other examples -- that's a
 * separate, not-yet-built concern (see the Phase 8.5 report).
 *
 * Safety: builds an in-memory snapshot of every source example before
 * writing anything, and rolls that snapshot back on any failure during the
 * write phase (restoring an in-place-reassigned example's original
 * gestureId, or deleting one that had to be given a fresh id to avoid an
 * id collision). Verifies the target's final example set (count, no
 * duplicate ids, and that every unchanged-id example's landmarks/capturedAt
 * still match the snapshot) BEFORE deleting any source gesture record --
 * source records are only ever deleted after that verification succeeds.
 * IndexedDB's separate object stores mean this can't be a single atomic
 * cross-store transaction, so this is the safest achievable sequence:
 * write-then-verify-then-delete, with an explicit rollback path for the
 * write phase.
 */
export async function mergePersonalizedGestures(
  sourceGestureIds: string[],
  targetGestureId: string,
): Promise<MergePersonalizedGesturesResult> {
  await ensureMigrated();

  if (sourceGestureIds.includes(targetGestureId)) {
    throw new Error("Target gesture cannot also be one of the source gestures");
  }

  const targetRecord = await getGestureRecord(targetGestureId);
  if (!targetRecord) {
    throw new Error(`Target gesture not found: ${targetGestureId}`);
  }

  for (const sourceId of sourceGestureIds) {
    if (!(await getGestureRecord(sourceId))) {
      throw new Error(`Source gesture not found: ${sourceId}`);
    }
  }

  // Step 5: in-memory snapshot, taken before any write, used for
  // verification and (if needed) rollback.
  const targetExamplesBefore = await getExamplesByGestureId(targetGestureId);
  const usedExampleIds = new Set(targetExamplesBefore.map((e) => e.id));

  interface PendingReassignment {
    original: StoredExampleRecord;
    reassigned: StoredExampleRecord;
    idChanged: boolean;
  }

  const pending: PendingReassignment[] = [];
  let malformedExamplesSkipped = 0;

  for (const sourceId of sourceGestureIds) {
    const sourceExamples = await getExamplesByGestureId(sourceId);
    for (const original of sourceExamples) {
      if (!isValidStoredExampleRecord(original)) {
        malformedExamplesSkipped++;
        continue;
      }
      const idChanged = usedExampleIds.has(original.id);
      const reassigned: StoredExampleRecord = {
        id: idChanged ? generateExampleId() : original.id,
        gestureId: targetGestureId,
        normalizedLandmarks: original.normalizedLandmarks,
        capturedAt: original.capturedAt,
      };
      usedExampleIds.add(reassigned.id);
      pending.push({ original, reassigned, idChanged });
    }
  }

  const written: PendingReassignment[] = [];
  try {
    for (const item of pending) {
      await putExampleRecord(item.reassigned);
      written.push(item);
    }

    // Verify BEFORE deleting anything.
    const finalExamples = await getExamplesByGestureId(targetGestureId);
    const expectedCount = targetExamplesBefore.length + pending.length;
    if (finalExamples.length !== expectedCount) {
      throw new Error(
        `Merge verification failed: expected ${expectedCount} examples on target ${targetGestureId}, found ${finalExamples.length}`,
      );
    }
    if (new Set(finalExamples.map((e) => e.id)).size !== finalExamples.length) {
      throw new Error(`Merge verification failed: duplicate example ids detected on target ${targetGestureId}`);
    }
    for (const item of pending) {
      if (item.idChanged) continue; // no prior identity to compare against
      const stored = await getExampleRecord(item.reassigned.id);
      if (!stored || stored.gestureId !== targetGestureId) {
        throw new Error(`Merge verification failed: example ${item.reassigned.id} did not land on the target gesture`);
      }
      if (!landmarksEqual(stored.normalizedLandmarks, item.original.normalizedLandmarks) || stored.capturedAt !== item.original.capturedAt) {
        throw new Error(`Merge verification failed: example ${item.reassigned.id}'s data does not match its source`);
      }
    }
    // Only now, after full verification, delete the source gesture
    // records. Anything still under a source's gestureId at this point is,
    // by construction, an example that was deliberately skipped for being
    // malformed (every structurally valid one was already reassigned onto
    // the target above) -- it's discarded along with its invalid parent
    // record, exactly like deletePersonalizedGesture() always removes a
    // gesture's examples together with the gesture itself, so nothing is
    // left orphaned in gestureExamples pointing at a deleted gesture.
    for (const sourceId of sourceGestureIds) {
      await deleteExamplesByGestureId(sourceId);
      await deleteGestureRecord(sourceId);
    }

    await putGestureRecord({ ...targetRecord, updatedAt: Date.now() });

    return {
      targetGestureId,
      targetName: targetRecord.name,
      examplesBefore: targetExamplesBefore.length,
      validExamplesMerged: pending.length,
      malformedExamplesSkipped,
      finalExampleCount: finalExamples.length,
      deletedSourceGestureIds: sourceGestureIds,
    };
  } catch (error) {
    // Roll back whatever was written so far. Source gesture records are
    // never touched until after verification succeeds (see above), so
    // there is nothing to restore for them -- only the target's example
    // set may have been partially modified.
    for (const item of written.reverse()) {
      if (item.idChanged) {
        await deleteExampleRecord(item.reassigned.id); // never existed before this merge attempt
      } else {
        await putExampleRecord(item.original); // restore its original gestureId
      }
    }
    throw error;
  }
}
