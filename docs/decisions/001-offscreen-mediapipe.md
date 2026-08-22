# 001 — Run MediaPipe in an offscreen document, not the content script

## Context

Camera-based gesture recognition needs `getUserMedia()`, a `<video>` element to decode frames into, and MediaPipe's WASM hand-landmark model running continuously. The extension also needs its overlay UI to appear on whatever page the user is looking at, and Chrome MV3 gives content scripts no persistent identity across page navigations, no guarantee they keep running when backgrounded, and no way to prompt for camera/microphone permission (an invisible context can't anchor a permission prompt).

## Decision

Camera capture, MediaPipe hand-landmark detection, gesture classification/matching, and the live-captions `SpeechRecognition` session all run inside a single **offscreen document** (`src/offscreen/offscreen.ts`), created and torn down by the service worker. The content script (`src/content/`) only renders the overlay and receives already-processed results over `chrome.runtime` messages.

## Why

- An offscreen document has a real DOM (required by both MediaPipe's WASM runtime and `<video>` decoding) but is owned by the service worker, not by any single tab — so one camera stream serves every tab the overlay is active on, instead of re-requesting the camera per tab.
- It survives independently of page navigation on whatever tab the user is viewing.
- It keeps camera/microphone access out of the content-script's isolated world entirely, so a hostile or buggy page can never directly touch the camera stream.

## Trade-offs

- An extra message hop (offscreen → service worker → content script) for every detection event, instead of the content script driving MediaPipe directly.
- Chrome allows only one offscreen document per extension, so camera/MediaPipe and live captions have to share it — the service worker has to track whether *either* capability still needs it before closing it.

## Consequences

Raw video frames and full landmark arrays never leave the offscreen document. What crosses the message boundary is always already-reduced: a gesture label, a confidence score, and (for personalized gestures) an already-localized meaning string. This shrinks the message payload and means no other context ever needs, or has access to, raw camera data.
