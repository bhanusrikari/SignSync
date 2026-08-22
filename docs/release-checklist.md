# SignSync — Release Checklist

Every item below is filed under exactly one of five categories, so "code exists" is never blurred with "verified."

---

## CODE VERIFIED
*(Confirmed by reading the current source directly.)*

- Single IndexedDB (`SignSyncDB`), unchanged version/store names, used identically by `offscreen.ts`, `record/App.tsx`, `validate/App.tsx`
- No hardcoded personalized gesture IDs anywhere in production code (repo-wide search)
- Last-known-good / retry / dynamic-discovery loader behavior preserved (`personalizedGesturesLoader.ts`)
- No per-frame IndexedDB reads (the detection loop calls only the loader's synchronous `.get()`)
- Personalized-gesture meaning is resolved to the current interface language before being sent from `offscreen.ts`
- No hardcoded secrets/API keys/tokens anywhere in `src/`
- No external network calls (`fetch`/`XMLHttpRequest`/`axios`) anywhere in production code — the extension has no backend
- CSP is scoped (`script-src 'self' 'wasm-unsafe-eval'`, no `unsafe-inline`, no remote hosts)
- Debug (`[PERS]`) diagnostics are console-only, never rendered in user-facing UI
- Camera/microphone raw frames are never persisted — only derived landmark vectors and transcript text, only locally
- The protected AI pipeline files (`gestureClassifier.ts`, `gestureFeatures.ts`, `gestureStabilizer.ts`, `personalizedGestureMatcher.ts`, `personalizedGestureRotation.ts`, `personalizedGestureStabilizer.ts`, `personalizedGesturesDb.ts`) are unmodified across the multilingual/UX work built on top of them
- No recognition-threshold, MediaPipe, camera-constraint, mirroring, or DB-schema changes anywhere in that work

## AUTOMATED TEST VERIFIED
*(Exact numbers from the last full run.)*

- `npm test -- --run` → **296/296 passed**, 20 test files
- `npm run typecheck` → **PASS**
- `npm run lint` (`--max-warnings 0`) → **PASS**
- `npm run build` → **PASS**, all 8 targets (popup, background, content, offscreen, permission, record, validate, tutorials)
- `dist/manifest.json` valid JSON, `manifest_version: 3`
- All 8 HTML entry points + `background.js`/`content.js` present in `dist/`
- `dist/mediapipe/wasm/*` and `dist/models/hand_landmarker.task` present
- i18n key parity (English ⇄ Hindi ⇄ Telugu, both directions, no orphaned keys) enforced by `i18n/index.test.ts`

## NEEDS MANUAL CHROME TEST
*(Cannot be verified without a real browser session.)*

- All tests in `docs/manual-test-plan.md`, especially:
  - Personalized gesture → Hindi/Telugu text and speech
  - Live captions in Hindi/Telugu (real per-OS/Chrome-version SpeechRecognition language support)
  - Camera/microphone permission flows end to end
  - Record page's camera guide overlay and instructional tips rendering correctly over a live video feed
  - Keyboard-only navigation through the Record wizard
  - Extension state surviving a full Chrome restart

## NEEDS HUMAN/LEGAL DECISION

- **Privacy policy**: none exists yet. Fine for a personal/demo build; required before any public Chrome Web Store listing.
- **`host_permissions: ["<all_urls>"]`**: broad by design (the overlay must work on arbitrary video-calling sites), but a human privacy/security sign-off is appropriate before wider distribution. The separate `activeTab` permission is likely redundant given `<all_urls>` is already granted, and could be removed as cleanup.
- **Hindi/Telugu translation quality**: all 175×2 translated strings were AI-assisted, not reviewed by a native speaker. Structurally correct (no empty/missing keys) but not verified for fluency or naturalness.
- **Formal accessibility audit**: no WCAG compliance is claimed. A dedicated audit (screen reader + keyboard-only pass) needs a human reviewer or a licensed audit tool.

## BLOCKED BY EXTERNAL CONTENT

- **Tutorial / Learn Sign Language content**: `TUTORIAL_SIGNS` is deliberately empty. A repo-wide search confirmed no licensed/verified ASL or ISL dataset exists in this repository. The data model (id/region/category/name/meaning/description/video/image/source/license) and a polished "coming soon" UI are both ready — only real, licensed content is missing, and it was not fabricated. This is a content-sourcing decision, not an engineering one.

---

## Overall release readiness

See `README.md`'s status line, or the finalization report, for the single-line verdict.
