# 004 — Temporal stabilization before emitting any gesture event

## Context

A hand transitioning between two shapes produces frames that don't cleanly belong to either shape's classification — a single frame's raw output can legitimately flicker between labels several times a second, especially near a decision boundary. Speech output, overlay text, and conversation history all react to gesture events; reacting to every raw per-frame classification would mean flickering text and, worse, the same word spoken multiple times per second while a gesture is simply being held.

## Decision

Both recognition paths (built-in and personalized) run through a dedicated stabilizer (`GestureStabilizer`, `PersonalizedGestureStabilizer`) that requires several consecutive frames to agree on the same result before emitting anything, and — critically — emits **only on the transition into** a new stable state, never once per matching frame afterward.

## Why

- Speech synthesis and conversation-history entries are one-shot, meaningful events from the user's perspective ("I made the 'thank you' sign"), not a continuous stream of per-frame observations.
- Debouncing at the classification layer (e.g. requiring N consecutive identical frames) would still fire again every time the count threshold is re-crossed while a gesture is held; emitting only on the actual transition is what guarantees "hold a gesture for 5 seconds" produces exactly one event, not several.

## Trade-offs

- Adds latency between a gesture starting and it being recognized (the stabilization window has to fill before a transition is confirmed) — a deliberate trade of a small delay for eliminating false triggers and repeat-firing.
- The built-in and personalized paths have separate stabilizers with independent state, so a transition in one path is completely invisible to the other — correct given they're independent detection systems, but it does mean there's no shared "is a hand currently doing something" signal between them.

## Consequences

`GESTURE_DETECTED` and `PERSONALIZED_GESTURE_DETECTED` messages are true one-per-transition events. Every downstream consumer (speech, overlay display, conversation history) can safely treat "I received this message" as "this is a new, distinct thing that just happened," with no additional deduplication logic needed at the consuming end.
