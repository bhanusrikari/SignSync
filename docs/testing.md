# Testing Strategy

## What's automated

`npm test` runs the full Vitest suite (see `package.json` for the exact command). All tests run in Vitest's `node` environment (no jsdom) — this project deliberately does not unit-test React components; see "What's not automated" below for why, and how that shaped the codebase.

**Unit tests, by area:**

- **Gesture recognition math** (`ai/*.test.ts`): the built-in classifier, the personalized-gesture matcher, and the rotation-invariant representation are tested against synthetic landmark fixtures covering translation, scale, rotation, and natural jitter — proving a gesture recorded at one position/angle/distance from the camera still matches when performed differently the next time. One suite (`personalizedGestureMatcher.realdata.test.ts`) additionally validates against a real, webcam-captured dataset when present (see `extension/real-data/README.md`) — it skips cleanly, rather than failing, when that optional file isn't there.
- **Stabilization** (`gestureStabilizer`-adjacent tests): confirms events fire only on genuine state transitions, never once per matching frame.
- **IndexedDB layer** (`services/personalizedGesturesDb.test.ts`, `services/personalizedGestures.test.ts`): CRUD correctness, legacy-data migration (including idempotency — running migration twice must not duplicate records), and recovery from a failed migration attempt.
- **Loader retry semantics** (`offscreen/personalizedGesturesLoader.test.ts`): a failed refresh must never clear a previously-successful gesture list; concurrent refresh calls must share one in-flight fetch rather than racing.
- **Domain validation** (`shared/personalizedGestures.test.ts`): malformed or corrupted stored records are rejected individually, never allowed to break an entire read.
- **Localization** (`i18n/index.test.ts`): every English key exists in Hindi and Telugu, and vice versa (no orphaned keys in either direction) — enforced automatically, not by manual review.
- **Conversation history** (`content/conversationEntry.test.ts`): each of the three event sources (built-in gesture, personalized gesture, speech caption) builds the correct entry shape, and interim/unsupported/empty captions are correctly excluded.
- **Captions error classification** (`shared/speechRecognitionErrors.test.ts`): every distinguished `SpeechRecognitionErrorEvent` code maps to the right user-facing category.
- **Accessibility class derivation** (`shared/accessibilityClasses.test.ts`): contrast/text-size/motion settings map to the correct CSS classes.

## Why component logic is extracted into plain functions

This codebase has no React component testing infrastructure. Rather than accept untested UI logic, form validation, conversation-entry construction, and accessibility-class derivation are deliberately written as plain, framework-free `.ts` functions that a `.tsx` component merely calls — so the *logic* is fully unit-tested even though the *rendering* isn't. This pattern is used consistently across the codebase, not just where it happened to be convenient.

## What automated tests cannot verify

Be precise about this rather than implying full coverage:

- **Real camera behavior.** Synthetic landmark fixtures prove the matching *math* is correct; they cannot prove MediaPipe's actual hand-tracking output, under real lighting and real hand variation, produces landmarks the tests would recognize.
- **Real Chrome runtime behavior.** `chrome.runtime.sendMessage`, offscreen document lifecycle, and service-worker suspension/wake are Chrome APIs with no meaningful Node-environment equivalent — the message-passing *shape* is type-checked, not runtime-verified end to end.
- **Microphone permission and SpeechRecognition support.** Real support varies by Chrome version, OS, and installed language packs — this can only be confirmed by running the extension.
- **Visual/screen-reader accessibility.** Semantic HTML and `aria-*` attributes are used throughout, but no automated test confirms actual screen-reader announcement behavior.
- **Real user experience.** Whether the Record wizard actually feels clear to a first-time user is a manual-QA question, not a unit-test question.

`docs/manual-test-plan.md` exists specifically to cover this gap with an explicit, repeatable checklist — treat a green `npm test` and a completed manual test plan as two different, both-required signals, not substitutes for each other.

## Build verification

`npm run build` runs `tsc --noEmit` followed by eight separate Vite builds (one per MV3 entry point: popup, background, content, offscreen, permission, record, validate, tutorials) — MV3's separately-lifecycled contexts can't share a single bundle. A green build confirms every entry point compiles and produces valid output; it does not confirm the resulting extension behaves correctly in Chrome (see above).
