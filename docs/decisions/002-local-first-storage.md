# 002 — Local-first storage, no required backend

## Context

TECH_SPEC's original scope sketched an optional FastAPI backend and optional Firebase integration (auth, cloud-synced personalized gestures, optional conversation history) — explicitly described as **optional**, with the requirement that "the extension should remain functional without authentication for the core gesture-recognition experience."

## Decision

SignSync ships with no backend at all. Every piece of state — settings, personalized gestures, conversation history — lives in `chrome.storage.local` and IndexedDB, entirely on the user's device. `extension/.env.example` still documents the placeholder Firebase/API variables from the original scope sketch, but nothing in the codebase reads them (`import.meta.env.VITE_FIREBASE_*` is referenced nowhere in `src/`).

## Why

- An accessibility tool that mediates real-time communication (camera, microphone, personal gesture vocabulary) has an unusually strong privacy expectation. Not needing a server for the core experience is a genuine product strength, not just a scope-cut.
- The spec's own "should remain functional without authentication" requirement effectively made the backend optional-in-practice for the features that ship in this version, and none of those features actually needed it once built.

## Trade-offs

- No cross-device sync for personalized gestures — a gesture recorded on one machine doesn't follow the user to another.
- No durable conversation history across browser sessions (a related, independent decision — see the architecture doc's §7).

## Consequences

Zero network calls exist anywhere in the codebase (verified by repo-wide search). This is straightforwardly and completely true today, not an aspiration — there is no fetch/XHR/WebSocket call in `src/`. If a synced-gestures feature is ever built, it should be an explicit, separately-reviewed addition, not something that silently activates because a placeholder env var got filled in.
