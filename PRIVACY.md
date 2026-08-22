# Privacy

This document describes what SignSync's current implementation actually does, verified by reading the source — not a general privacy-policy template. If SignSync's implementation changes, this document should change with it.

## Camera

The camera stream is requested only when the "Gesture Recognition" feature is enabled, and only after Chrome's normal camera-permission prompt is granted. The stream is captured and processed entirely inside the extension's offscreen document (`extension/src/offscreen/offscreen.ts`) — hand-landmark detection (MediaPipe) and gesture classification/matching both run **locally, in the browser, on-device**. Raw video frames and full landmark arrays are never sent anywhere, including to other parts of the extension itself: what crosses into a message is only a small, already-reduced result (a gesture label, a confidence score, and — for personalized gestures — an already-localized meaning string). There is no network call anywhere in this codebase that a camera frame or landmark array could travel over.

## Microphone

The microphone is requested only when "Live Captions" is enabled, and only after Chrome's microphone-permission prompt is granted. Audio is processed through the browser's built-in `SpeechRecognition` (Web Speech API), not a service SignSync operates.

**This is the one caveat that cannot be guaranteed purely on-device**: depending on Chrome's own implementation and the platform, `SpeechRecognition` may process audio through a Google speech-recognition service rather than fully on-device — this is standard behavior of the Web Speech API across browsers generally, governed by Chrome itself, not something SignSync controls, configures, or can bypass. SignSync does not add any additional network transmission of audio beyond whatever the browser's own `SpeechRecognition` implementation does.

## Personalized gestures

Gestures you record (name, meaning, translations, and the landmark examples that let SignSync recognize them) are stored locally in the browser's IndexedDB (`SignSyncDB`) and are never transmitted anywhere. Deleting a gesture in the Validate page removes both its metadata and every associated recorded example.

## Settings and conversation history

Feature toggles and preferences (language, accessibility settings, etc.) are stored in `chrome.storage.local`, local to your browser profile. The live "Conversation" panel in the overlay is intentionally **not** persisted — it exists only in memory for the current session and clears whenever the extension is re-enabled or the tab is closed.

## Network / third-party services

SignSync has no backend server. A repository-wide search confirms there is no `fetch`, `XMLHttpRequest`, or equivalent network call anywhere in the extension's source (outside of whatever Chrome's own `SpeechRecognition` implementation does internally, as described above). `extension/.env.example` documents placeholder configuration for an optional Firebase/backend integration that was scoped early in the project but is not implemented or referenced anywhere in the current code — see `docs/decisions/002-local-first-storage.md`.

## Permissions requested

- **`storage`** — for settings and personalized-gesture data described above.
- **`activeTab`** / **`host_permissions: ["<all_urls>"]`** — the floating overlay needs to render on whatever video-calling or communication site the user is using, which cannot be enumerated in advance.
- **`offscreen`** — required to run camera/MediaPipe/SpeechRecognition off the service worker (see `docs/architecture.md`).
- Camera and microphone access are requested at the point of use via `getUserMedia()`, through Chrome's standard permission-prompt flow — they are not declared as blanket manifest permissions.

## What this document does not cover

This is not a legally-reviewed privacy policy. If SignSync is ever published to the Chrome Web Store or distributed publicly, a proper privacy-policy review (and, if a backend/sync feature is ever added, a corresponding update to this document) should happen first.
