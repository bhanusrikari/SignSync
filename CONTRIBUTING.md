# Contributing to SignSync

## Setup

```bash
cd extension
npm install
npm run build       # produces extension/dist/
```

Load `extension/dist/` as an unpacked extension: `chrome://extensions` → enable Developer mode → **Load unpacked** → select `extension/dist`.

For iterative development, `npm run dev` (from `extension/`) starts Vite's dev server for the popup; the other seven MV3 entry points (background/content/offscreen/permission/record/validate/tutorials) each need a full `npm run build` to pick up changes, since they're separate MV3 contexts, not hot-reloadable app routes.

## Branch naming

Match the existing history's convention: `feat/<short-description>`, `fix/<short-description>`, `chore/<short-description>`.

## Before opening a PR

```bash
npm test
npm run typecheck
npm run lint
npm run build
```

All four must pass. None of these are optional — CI (if configured) will run the same commands.

## Commit expectations

Write commit messages that explain *why*, not just *what* — the diff already shows what changed. Keep commits reasonably scoped; a commit that touches the AI pipeline should never also carry an unrelated UI change.

## The protected AI pipeline

`extension/src/ai/gestureClassifier.ts`, `gestureFeatures.ts`, `gestureStabilizer.ts`, `personalizedGestureMatcher.ts`, `personalizedGestureRotation.ts`, `personalizedGestureStabilizer.ts`, and `extension/src/services/personalizedGesturesDb.ts` implement the actual recognition math and the personalized-gesture storage schema. Changes here have a much higher bar than everywhere else in the codebase:

- **Never** change a recognition/confidence threshold to make a demo "feel better" without a specific, reproducible failure case driving it.
- **Never** hardcode a specific gesture ID anywhere in production code — the set of recognizable personalized gestures must always be derived dynamically from storage.
- **Never** bump `DB_VERSION` or rename an IndexedDB store/index without a real, tested migration path — `services/personalizedGestures.ts`'s existing migration tests are the bar to match.
- If a change here is genuinely necessary, it needs new or updated tests in the corresponding `*.test.ts`/`*.validation.test.ts` file proving the change is correct, not just that it compiles.
- If a feature can be implemented at the presentation/message layer instead (localization, formatting, UI) — do that instead of touching these files. See `docs/decisions/005-multilingual-presentation-layer.md` for a worked example of this principle.

## Testing conventions

- Tests live next to the code they test (`foo.ts` → `foo.test.ts`), run under Vitest's `node` environment.
- React components (`.tsx`) are not unit-tested directly in this codebase — extract logic that needs test coverage into a plain `.ts` function first (see `docs/testing.md`).
- Don't delete or weaken an existing test to make a change pass — fix the change or update the test's assertions to reflect a genuinely new, intentional behavior.

## Style

ESLint (`npm run lint`, `--max-warnings 0`) and `tsc --noEmit` are the enforced style/correctness bar — no separate style guide beyond what those enforce.
