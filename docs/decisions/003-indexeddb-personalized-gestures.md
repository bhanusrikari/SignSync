# 003 — IndexedDB, with gestures and examples as separate object stores

## Context

A personalized gesture is a name/meaning pair plus a growable set of recorded landmark examples (typically 5+, sometimes 50+, for good recognition coverage). This needs to be written from three separate extension pages (`record.html`, `validate.html`'s merge flow) and read from a fourth (the offscreen document's live matcher) — all against the exact same data, with no possibility of divergence between what the recognizer sees and what the user sees in Validate.

## Decision

A single IndexedDB database, `SignSyncDB` (`services/personalizedGesturesDb.ts`), with two object stores: `personalizedGestures` (one row per gesture: name, default meaning, optional per-language meanings, enabled flag) and `gestureExamples` (one row per captured landmark snapshot, indexed by `gestureId`). `chrome.storage.local` was considered and rejected for this data specifically.

## Why

- **IndexedDB over `chrome.storage.local`**: personalized gestures can accumulate a meaningful amount of landmark data (21 points × 3 coordinates × dozens of examples × multiple gestures) — well within IndexedDB's expectations, uncomfortably close to `chrome.storage.local`'s much smaller practical limits.
- **Two stores over one embedded array**: a gesture's examples are genuinely a one-to-many child relationship, not an intrinsic part of the gesture's own identity. Splitting them lets an example be added or removed (Record's "add more examples" flow, Validate's duplicate-merge flow) without reading, mutating, and rewriting the entire gesture record and its full example array every time.
- **One database, read by every context**: `DB_NAME`/`DB_VERSION`/store-name constants are exported from one module and imported identically everywhere they're needed — the live matcher in the offscreen document is structurally guaranteed to be reading the same store `record.html` just wrote to, not a second, accidentally-divergent database.

## Trade-offs

- IndexedDB's API is lower-level and more verbose than `chrome.storage.local`'s promise-based get/set — `personalizedGesturesDb.ts` exists specifically to absorb that verbosity into a small, tested surface the rest of the app never has to touch directly.
- Schema changes require a real IndexedDB version bump and upgrade handler, not just a new field — the schema has stayed at version 1 throughout, with new fields (like per-language meanings) added as optional properties instead, since IndexedDB's object stores are schemaless at the row level.

## Consequences

The live recognition path never reads IndexedDB directly on a per-frame basis — it reads a synchronous, already-fetched in-memory snapshot (see ADR 001's sibling concern in the architecture doc, §4) that's refreshed on every recognition activation, not continuously polled. A gesture recorded while the camera is off becomes recognizable the next time recognition is turned on, with no separate "sync" step.
