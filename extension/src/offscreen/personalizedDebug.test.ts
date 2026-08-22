import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isPersonalizedDebugEnabled, personalizedDebug, setPersonalizedDebugEnabled } from "./personalizedDebug";

describe("personalizedDebug", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    setPersonalizedDebugEnabled(true);
  });

  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
    setPersonalizedDebugEnabled(true); // restore default for other test files
  });

  it("is enabled by default", () => {
    expect(isPersonalizedDebugEnabled()).toBe(true);
  });

  it("logs every category with the single [PERS] prefix when enabled", () => {
    personalizedDebug.db({ dbName: "SignSyncDB", dbVersion: 1, storeName: "personalizedGestures", count: 1, ids: ["F85B78"], names: ["super"], exampleCounts: [54] });
    personalizedDebug.loader({ loaded: true, loading: false, lastSuccessAt: 123, count: 1, ids: ["F85B78"] });
    personalizedDebug.frame({ handDetected: true, gestureCount: 1, candidateIds: ["F85B78"] });
    personalizedDebug.matchAccepted({ id: "F85B78", name: "super", distance: 0.03, confidence: 0.9, threshold: 0.35 });
    personalizedDebug.matchRejected({ reason: "distance exceeds MAX_ACCEPTABLE_DISTANCE", bestId: "F85B78", bestName: "super", distance: 0.5, confidence: 0, threshold: 0.35 });
    personalizedDebug.stabilizer({ incomingId: "F85B78", window: ["F85B78", "F85B78", "F85B78"], stableId: "F85B78", emitted: true });
    personalizedDebug.message({ sent: true, type: "PERSONALIZED_GESTURE_DETECTED", gestureId: "F85B78" });

    expect(logSpy).toHaveBeenCalledTimes(7);
    for (const call of logSpy.mock.calls) {
      expect(call[0]).toMatch(/^\[PERS\] /);
    }
  });

  it("suppresses all [PERS] logging when disabled via setPersonalizedDebugEnabled(false)", () => {
    setPersonalizedDebugEnabled(false);
    personalizedDebug.frame({ handDetected: true, gestureCount: 0, candidateIds: [] });
    personalizedDebug.matchRejected({ reason: "no personalized gestures loaded", bestId: null, bestName: null, distance: Infinity, confidence: 0, threshold: 0.35 });
    expect(logSpy).not.toHaveBeenCalled();
  });

  it("errors always print regardless of the debug flag", () => {
    setPersonalizedDebugEnabled(false);
    personalizedDebug.error("loadPersonalizedGestures", new Error("boom"));
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0][0]).toBe("[PERS] ERROR");
  });

  it("window.__SIGNSYNC_PERS_DEBUG__ overrides the fallback flag when present", () => {
    (globalThis as unknown as { window: Record<string, unknown> }).window = { __SIGNSYNC_PERS_DEBUG__: false };
    try {
      expect(isPersonalizedDebugEnabled()).toBe(false);
      personalizedDebug.frame({ handDetected: true, gestureCount: 1, candidateIds: ["F85B78"] });
      expect(logSpy).not.toHaveBeenCalled();
    } finally {
      delete (globalThis as unknown as { window?: unknown }).window;
    }
  });
});
