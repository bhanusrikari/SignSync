# 005 — Multilingual support lives in the presentation layer, not the recognition pipeline

## Context

SignSync supports English, Hindi, and Telugu interface text, live captions, and gesture-to-speech/text output. The recognition pipeline (hand landmarks → classification/matching) has no inherent concept of language — it operates purely on geometry.

## Decision

The AI pipeline (`ai/gestureClassifier.ts`, `ai/personalizedGestureMatcher.ts`, `ai/personalizedGestureRotation.ts`, `ai/personalizedGestureStabilizer.ts`) never receives, stores, or reasons about a language setting. Localization happens strictly after a match is decided:

- Built-in gestures: the canonical (English) command string produced by the pipeline is separately re-mapped to the display language by a presentation-only helper (`getLocalizedGestureText`) in the content script.
- Personalized gestures: the offscreen document resolves the gesture's per-language meaning (falling back to its default English meaning) *before* sending the detection message, so every consumer of that message already agrees on the correct text.

## Why

- Keeping language entirely out of the recognition layer means gesture-matching logic can be modified, tuned, or tested without any risk of accidentally coupling it to i18n concerns — a change to how Hindi strings are formatted can never affect matcher behavior, by construction, not by convention.
- It also means adding a language costs nothing on the recognition side — only a new i18n catalog file and (for personalized gestures) new optional translation fields.

## Trade-offs

- Interface language, caption language, and speech-output language are unified into a single setting rather than three independently-configurable pickers. This was weighed against the added state-management complexity of three independent selectors for a use case (captioning in a different language than the interface) that wasn't a stated requirement — a deliberate scope decision, revisitable if that requirement appears.

## Consequences

A personalized gesture recorded without any translations still works correctly in every supported language — `getLocalizedMeaning()` falls back to the gesture's default English meaning for any language missing a translation, so there is no "broken" state, only a "not yet translated, showing English" state.
