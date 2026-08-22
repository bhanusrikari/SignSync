# 006 — A single typed message union, with the service worker as the required relay

## Context

MV3's contexts (popup, service worker, content script, offscreen document, extension pages) cannot share memory or call each other's functions directly. `chrome.runtime.sendMessage` can reach the service worker from anywhere, but **cannot** reach a content script directly — only `chrome.tabs.sendMessage`, which needs a `tabId`, can, and only the service worker can enumerate tabs.

## Decision

Every message that crosses a context boundary is a variant of one discriminated union, `SignSyncMessage` (`src/types/index.ts`), matched on a `type` field. The service worker is the mandatory relay for every offscreen-document event (`GESTURE_DETECTED`, `PERSONALIZED_GESTURE_DETECTED`, `CAPTION_UPDATE`) on its way to content scripts — the offscreen document never tries to reach a tab directly, and never could.

## Why

- A single typed union means every message's shape is checked by the compiler at both the sending and receiving end — adding a new message type without updating every consumer's switch/if-chain is a type error, not a silent runtime miss.
- Centralizing state mutation in the service worker (`applyAndBroadcast()`) means there's exactly one place that persists a settings change and then decides what side effects (starting/stopping the camera, restarting captions) that change should trigger — no context can mutate shared state without going through it.

## Trade-offs

- Every offscreen-document event takes two hops (offscreen → service worker → content script) instead of one, and every hop can independently fail — every relay call is wrapped in a swallow-and-log rather than allowing a delivery failure to interrupt the camera/hand-tracking loop that produced it.
- The service worker can be suspended and restarted by Chrome at any time in MV3; nothing here assumes it stays warm, which is why persisted state always round-trips through `chrome.storage.local` rather than being held only in service-worker memory.

## Consequences

Adding a new cross-context capability (e.g. this project's addition of live captions after gesture recognition already existed) follows the exact same shape as everything before it: define the message variant, add it to the union, relay it through the service worker, handle it in the content script. No new plumbing pattern was needed.
