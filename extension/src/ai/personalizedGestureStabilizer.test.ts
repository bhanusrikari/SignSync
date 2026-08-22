import { describe, expect, it } from "vitest";
import { PersonalizedGestureStabilizer } from "./personalizedGestureStabilizer";
import { matchPersonalizedGestureRotationInvariant } from "./personalizedGestureRotation";
import { FIST, OPEN_HAND, THUMB_OUT, buildGesture, jitter } from "./personalizedGestureMatcher.fixtures";
import type { PersonalizedGestureMatchResult } from "./personalizedGestureMatcher";

function matchOf(gestureId: string, name: string, distance = 0.01, confidence = 0.9): PersonalizedGestureMatchResult {
  return { gestureId, name, meaning: `${name} meaning`, confidence, distance, matched: true };
}

const NO_MATCH: PersonalizedGestureMatchResult = {
  gestureId: null,
  name: null,
  meaning: null,
  confidence: 0,
  distance: Infinity,
  matched: false,
};

describe("PersonalizedGestureStabilizer: requires multiple consistent frames", () => {
  it("does not emit after a single matching frame (below minOccurrences)", () => {
    const stabilizer = new PersonalizedGestureStabilizer();
    expect(stabilizer.push(matchOf("super", "super"), 1)).toBeNull();
    expect(stabilizer.push(matchOf("super", "super"), 2)).toBeNull();
  });

  it("emits once the default window/majority (3 of 5) is reached", () => {
    const stabilizer = new PersonalizedGestureStabilizer();
    expect(stabilizer.push(matchOf("super", "super"), 1)).toBeNull();
    expect(stabilizer.push(matchOf("super", "super"), 2)).toBeNull();
    const event = stabilizer.push(matchOf("super", "super"), 3);
    expect(event).not.toBeNull();
    expect(event?.gestureId).toBe("super");
    expect(event?.name).toBe("super");
  });

  it("respects injected windowSize/minOccurrences", () => {
    const stabilizer = new PersonalizedGestureStabilizer(3, 2);
    expect(stabilizer.push(matchOf("super", "super"), 1)).toBeNull();
    const event = stabilizer.push(matchOf("super", "super"), 2);
    expect(event?.gestureId).toBe("super");
  });
});

describe("PersonalizedGestureStabilizer: repeated stable frames produce only one event", () => {
  it("does not re-emit for every subsequent frame of the same stable gesture", () => {
    const stabilizer = new PersonalizedGestureStabilizer();
    stabilizer.push(matchOf("super", "super"), 1);
    stabilizer.push(matchOf("super", "super"), 2);
    const first = stabilizer.push(matchOf("super", "super"), 3);
    expect(first).not.toBeNull();
    for (let t = 4; t <= 10; t++) {
      expect(stabilizer.push(matchOf("super", "super"), t)).toBeNull();
    }
  });
});

describe("PersonalizedGestureStabilizer: transition to no match resets state", () => {
  it("emits nothing on the transition to no-match, then re-emits on returning to the SAME gesture", () => {
    const stabilizer = new PersonalizedGestureStabilizer();
    stabilizer.push(matchOf("super", "super"), 1);
    stabilizer.push(matchOf("super", "super"), 2);
    expect(stabilizer.push(matchOf("super", "super"), 3)).not.toBeNull();

    // Drive it back to a stable "no match" state.
    expect(stabilizer.push(NO_MATCH, 4)).toBeNull();
    expect(stabilizer.push(NO_MATCH, 5)).toBeNull();
    expect(stabilizer.push(NO_MATCH, 6)).toBeNull();

    // Re-matching "super" now must fire a fresh event, not be suppressed as
    // "unchanged" -- state was reset when it went through no-match.
    stabilizer.push(matchOf("super", "super"), 7);
    stabilizer.push(matchOf("super", "super"), 8);
    const reEmitted = stabilizer.push(matchOf("super", "super"), 9);
    expect(reEmitted).not.toBeNull();
    expect(reEmitted?.gestureId).toBe("super");
  });
});

describe("PersonalizedGestureStabilizer: transition between two different personalized gestures", () => {
  it("emits a new event when the stable id changes directly from one gesture to another", () => {
    const stabilizer = new PersonalizedGestureStabilizer();
    stabilizer.push(matchOf("super", "super"), 1);
    stabilizer.push(matchOf("super", "super"), 2);
    expect(stabilizer.push(matchOf("super", "super"), 3)).not.toBeNull();

    stabilizer.push(matchOf("thanks", "thanks"), 4);
    stabilizer.push(matchOf("thanks", "thanks"), 5);
    const event = stabilizer.push(matchOf("thanks", "thanks"), 6);
    expect(event).not.toBeNull();
    expect(event?.gestureId).toBe("thanks");
    expect(event?.name).toBe("thanks");
  });
});

describe("PersonalizedGestureStabilizer: identity is gestureId, not name", () => {
  it("two gestures sharing the same name are tracked as distinct stable states", () => {
    const stabilizer = new PersonalizedGestureStabilizer();
    // "super" #1 (id A) becomes stable.
    stabilizer.push(matchOf("id-A", "super"), 1);
    stabilizer.push(matchOf("id-A", "super"), 2);
    const first = stabilizer.push(matchOf("id-A", "super"), 3);
    expect(first?.gestureId).toBe("id-A");

    // "super" #2 (id B, same display name, different id) must be treated as
    // a genuine transition, not a no-op just because the name is unchanged.
    stabilizer.push(matchOf("id-B", "super"), 4);
    stabilizer.push(matchOf("id-B", "super"), 5);
    const second = stabilizer.push(matchOf("id-B", "super"), 6);
    expect(second).not.toBeNull();
    expect(second?.gestureId).toBe("id-B");
  });

  it("reports the name/meaning belonging to the winning id even if a stray differently-named frame is in the window", () => {
    const stabilizer = new PersonalizedGestureStabilizer(5, 3);
    // Window fills with mostly "super" (id-A) with one stray "thanks" vote
    // mixed in -- id-A still wins the majority (3 of 5), and the reported
    // name/meaning must belong to id-A, not to whichever frame happened to
    // be pushed last.
    stabilizer.push(matchOf("id-A", "super"), 1);
    stabilizer.push(matchOf("id-A", "super"), 2);
    stabilizer.push(matchOf("thanks-id", "thanks"), 3);
    const event = stabilizer.push(matchOf("id-A", "super"), 4);
    expect(event?.gestureId).toBe("id-A");
    expect(event?.name).toBe("super");
  });
});

describe("PersonalizedGestureStabilizer: matcher rejection never emits", () => {
  it("a fully unmatched stream never emits any event", () => {
    const stabilizer = new PersonalizedGestureStabilizer();
    for (let t = 1; t <= 10; t++) {
      expect(stabilizer.push(NO_MATCH, t)).toBeNull();
    }
  });

  it("consuming real matchPersonalizedGestureRotationInvariant() rejections (ambiguous/low-confidence) never emits", () => {
    const stabilizer = new PersonalizedGestureStabilizer();
    const fistGesture = buildGesture("fist", "Fist", FIST);
    const thumbOutGesture = buildGesture("thumb-out", "ThumbOut", THUMB_OUT);
    // Confirmed Phase 5 false-positive case: a Fist query against a stored
    // ThumbOut example must never match, and thus never stabilize/emit.
    for (let t = 1; t <= 6; t++) {
      const result = matchPersonalizedGestureRotationInvariant(jitter(FIST, 0.02, t), [thumbOutGesture, fistGesture]);
      const event = stabilizer.push(result, t);
      // Either it correctly matches "fist" itself, or it emits nothing --
      // it must never emit "thumb-out".
      if (event) expect(event.gestureId).not.toBe("thumb-out");
    }
  });
});

describe("PersonalizedGestureStabilizer: debug snapshot (Phase 9.1 diagnostics)", () => {
  it("reflects the current window contents and stable id, read-only", () => {
    const stabilizer = new PersonalizedGestureStabilizer();
    expect(stabilizer.getDebugSnapshot()).toEqual({ window: [], stableId: null });

    stabilizer.push(matchOf("super", "super"), 1);
    stabilizer.push(matchOf("super", "super"), 2);
    let snapshot = stabilizer.getDebugSnapshot();
    expect(snapshot.window).toEqual(["super", "super"]);
    expect(snapshot.stableId).toBeNull(); // not yet reached minOccurrences

    stabilizer.push(matchOf("super", "super"), 3);
    snapshot = stabilizer.getDebugSnapshot();
    expect(snapshot.stableId).toBe("super");
  });
});

describe("PersonalizedGestureStabilizer + matcher integration: 0/1/multiple gestures", () => {
  it("no personalized gestures -- never emits", () => {
    const stabilizer = new PersonalizedGestureStabilizer();
    for (let t = 1; t <= 6; t++) {
      const result = matchPersonalizedGestureRotationInvariant(jitter(OPEN_HAND, 0.02, t), []);
      expect(stabilizer.push(result, t)).toBeNull();
    }
  });

  it("one personalized gesture -- stabilizes and emits on a genuine match", () => {
    const stabilizer = new PersonalizedGestureStabilizer();
    const gesture = buildGesture("open-hand", "OpenHand", OPEN_HAND);
    let event = null;
    for (let t = 1; t <= 5; t++) {
      const result = matchPersonalizedGestureRotationInvariant(jitter(OPEN_HAND, 0.02, t + 50), [gesture]);
      event = stabilizer.push(result, t) ?? event;
    }
    expect(event).not.toBeNull();
    expect(event?.gestureId).toBe("open-hand");
  });

  it("multiple personalized gestures -- stabilizes on the correct one, distinguishing the others", () => {
    const stabilizer = new PersonalizedGestureStabilizer();
    const openHandGesture = buildGesture("open-hand", "OpenHand", OPEN_HAND);
    const fistGesture = buildGesture("fist", "Fist", FIST);
    const thumbOutGesture = buildGesture("thumb-out", "ThumbOut", THUMB_OUT);
    let event = null;
    for (let t = 1; t <= 5; t++) {
      const result = matchPersonalizedGestureRotationInvariant(jitter(FIST, 0.02, t + 90), [
        openHandGesture,
        fistGesture,
        thumbOutGesture,
      ]);
      event = stabilizer.push(result, t) ?? event;
    }
    expect(event?.gestureId).toBe("fist");
  });

  it("malformed gesture list entries do not crash the stabilizer or matcher", () => {
    const stabilizer = new PersonalizedGestureStabilizer();
    const malformedGestures = [null, undefined, { id: "broken" }] as unknown as Parameters<
      typeof matchPersonalizedGestureRotationInvariant
    >[1];
    expect(() => {
      for (let t = 1; t <= 4; t++) {
        const result = matchPersonalizedGestureRotationInvariant(jitter(OPEN_HAND, 0.02, t), malformedGestures);
        stabilizer.push(result, t);
      }
    }).not.toThrow();
  });
});
