/**
 * Unit tests for the pure SpeechRecognition error-classification helpers.
 * The actual browser SpeechRecognition implementation is not (and cannot
 * be) unit-tested here -- only classifySpeechRecognitionError()'s string
 * mapping and isSpeechRecognitionSupported()'s feature-detection guard.
 */
import { describe, expect, it } from "vitest";
import { classifySpeechRecognitionError, isSpeechRecognitionSupported } from "./speechRecognitionErrors";

describe("classifySpeechRecognitionError", () => {
  it('maps "not-allowed" to denied', () => {
    expect(classifySpeechRecognitionError("not-allowed")).toBe("denied");
  });

  it('maps "no-speech" to no_speech', () => {
    expect(classifySpeechRecognitionError("no-speech")).toBe("no_speech");
  });

  it('maps "audio-capture" to no_microphone', () => {
    expect(classifySpeechRecognitionError("audio-capture")).toBe("no_microphone");
  });

  it('maps "network" to network_error', () => {
    expect(classifySpeechRecognitionError("network")).toBe("network_error");
  });

  it('maps "aborted" to aborted', () => {
    expect(classifySpeechRecognitionError("aborted")).toBe("aborted");
  });

  it('maps "language-not-supported" to language_not_supported (Phase 10 Part 8)', () => {
    expect(classifySpeechRecognitionError("language-not-supported")).toBe("language_not_supported");
  });

  it("maps an unknown error code to the generic error status", () => {
    expect(classifySpeechRecognitionError("some-future-error-code")).toBe("error");
  });
});

describe("isSpeechRecognitionSupported", () => {
  it("returns false in a non-browser environment (no window)", () => {
    // This test runs under Vitest's "node" environment (see
    // vitest.config.ts) -- `window` genuinely does not exist here, which
    // is itself a real "unsupported" case this helper must handle safely.
    expect(isSpeechRecognitionSupported()).toBe(false);
  });
});
