import { describe, expect, it } from "vitest";
import {
  checkCaptureReadiness,
  cleanLocalizedMeanings,
  describeReadiness,
  hasEnoughExamples,
  isNearDuplicateOfLast,
  MIN_EXAMPLES,
  validateGestureMeaning,
  validateGestureName,
} from "./recordingValidation";
import type { PersonalizedGestureExample } from "@/types";
import type { Point3D } from "@/ai/gestureTypes";

function makeLandmarks(offset = 0): Point3D[] {
  return Array.from({ length: 21 }, (_, i) => ({ x: i * 0.01 + offset, y: i * 0.02, z: 0 }));
}

function makeExample(landmarks: Point3D[], capturedAt = Date.now()): PersonalizedGestureExample {
  return { normalizedLandmarks: landmarks, capturedAt };
}

describe("checkCaptureReadiness", () => {
  it("is ready with exactly one hand and 21 finite landmarks", () => {
    expect(checkCaptureReadiness(1, makeLandmarks())).toEqual({ ready: true });
  });

  it("reports no_hand when nothing is detected", () => {
    expect(checkCaptureReadiness(0, undefined)).toEqual({ ready: false, reason: "no_hand" });
  });

  it("reports no_hand when handsDetected is 0 even if stale landmarks are passed", () => {
    expect(checkCaptureReadiness(0, makeLandmarks())).toEqual({ ready: false, reason: "no_hand" });
  });

  it("reports multiple_hands when more than one hand is detected", () => {
    expect(checkCaptureReadiness(2, makeLandmarks())).toEqual({ ready: false, reason: "multiple_hands" });
  });

  it("reports wrong_landmark_count when the landmark array isn't length 21", () => {
    expect(checkCaptureReadiness(1, makeLandmarks().slice(0, 10))).toEqual({
      ready: false,
      reason: "wrong_landmark_count",
    });
  });

  it("reports non_finite_landmarks when a coordinate is NaN or Infinity", () => {
    const landmarks = makeLandmarks();
    landmarks[5] = { x: NaN, y: 0, z: 0 };
    expect(checkCaptureReadiness(1, landmarks)).toEqual({ ready: false, reason: "non_finite_landmarks" });

    const landmarks2 = makeLandmarks();
    landmarks2[5] = { x: 0, y: Infinity, z: 0 };
    expect(checkCaptureReadiness(1, landmarks2)).toEqual({ ready: false, reason: "non_finite_landmarks" });
  });
});

describe("describeReadiness", () => {
  it("matches the required status copy", () => {
    expect(describeReadiness({ ready: true })).toBe("Hand detected — ready to capture");
    expect(describeReadiness({ ready: false, reason: "no_hand" })).toBe("No hand detected");
    expect(describeReadiness({ ready: false, reason: "multiple_hands" })).toContain("Multiple hands");
    expect(describeReadiness({ ready: false, reason: "wrong_landmark_count" })).toContain("Hand tracking lost");
    expect(describeReadiness({ ready: false, reason: "non_finite_landmarks" })).toContain("Hand tracking lost");
  });
});

describe("isNearDuplicateOfLast", () => {
  it("is false when there are no prior examples", () => {
    expect(isNearDuplicateOfLast(makeLandmarks(), [])).toBe(false);
  });

  it("is true for an (almost) identical repeat of the last capture", () => {
    const examples = [makeExample(makeLandmarks())];
    expect(isNearDuplicateOfLast(makeLandmarks(), examples)).toBe(true);
  });

  it("is false for a meaningfully different pose", () => {
    const examples = [makeExample(makeLandmarks())];
    expect(isNearDuplicateOfLast(makeLandmarks(5), examples)).toBe(false);
  });

  it("only compares against the most recent example, not earlier ones", () => {
    const examples = [makeExample(makeLandmarks()), makeExample(makeLandmarks(5))];
    // Matches the FIRST example exactly, but that's no longer "last".
    expect(isNearDuplicateOfLast(makeLandmarks(), examples)).toBe(false);
  });
});

describe("hasEnoughExamples", () => {
  it("requires at least MIN_EXAMPLES", () => {
    expect(hasEnoughExamples(MIN_EXAMPLES - 1)).toBe(false);
    expect(hasEnoughExamples(MIN_EXAMPLES)).toBe(true);
    expect(hasEnoughExamples(MIN_EXAMPLES + 3)).toBe(true);
  });
});

describe("validateGestureName / validateGestureMeaning", () => {
  it("rejects empty and whitespace-only values", () => {
    expect(validateGestureName("", "en-IN")).toBeTruthy();
    expect(validateGestureName("   ", "en-IN")).toBeTruthy();
    expect(validateGestureMeaning("", "en-IN")).toBeTruthy();
    expect(validateGestureMeaning("   ", "en-IN")).toBeTruthy();
  });

  it("accepts a non-empty trimmed value", () => {
    expect(validateGestureName("Busy", "en-IN")).toBeNull();
    expect(validateGestureMeaning("I'm busy right now", "en-IN")).toBeNull();
  });

  it("localizes the validation message (Phase 11 Part F)", () => {
    expect(validateGestureName("", "hi-IN")).toBe("संकेत का नाम आवश्यक है।");
    expect(validateGestureMeaning("", "te-IN")).toBe("అర్థం అవసరం.");
  });
});

describe("cleanLocalizedMeanings (Phase 10.1 Part 2)", () => {
  it("English only -- no translations entered at all returns undefined", () => {
    expect(cleanLocalizedMeanings({})).toBeUndefined();
  });

  it("English + Hindi only", () => {
    expect(cleanLocalizedMeanings({ "hi-IN": "बहुत बढ़िया" })).toEqual({ "hi-IN": "बहुत बढ़िया" });
  });

  it("English + Telugu only", () => {
    expect(cleanLocalizedMeanings({ "te-IN": "చాలా బాగుంది" })).toEqual({ "te-IN": "చాలా బాగుంది" });
  });

  it("all three languages provided", () => {
    expect(cleanLocalizedMeanings({ "hi-IN": "बहुत बढ़िया", "te-IN": "చాలా బాగుంది" })).toEqual({
      "hi-IN": "बहुत बढ़िया",
      "te-IN": "చాలా బాగుంది",
    });
  });

  it("a blank/whitespace-only translation is dropped, not saved as an empty string", () => {
    expect(cleanLocalizedMeanings({ "hi-IN": "   ", "te-IN": "చాలా బాగుంది" })).toEqual({ "te-IN": "చాలా బాగుంది" });
  });

  it("every value is trimmed", () => {
    expect(cleanLocalizedMeanings({ "hi-IN": "  बहुत बढ़िया  " })).toEqual({ "hi-IN": "बहुत बढ़िया" });
  });

  it("all fields blank returns undefined, not an empty object", () => {
    expect(cleanLocalizedMeanings({ "hi-IN": "", "te-IN": "   " })).toBeUndefined();
  });
});
