/**
 * Shared SpeechRecognition diagnostics for the live-captions feature
 * (offscreen document). Mirrors shared/camera.ts's design philosophy --
 * pure error classification, no chrome/DOM side effects -- but for a
 * genuinely different error vocabulary: SpeechRecognition's own `onerror`
 * event codes (a fixed set of strings), not getUserMedia's DOMException
 * names. The one-time microphone *permission* check itself reuses
 * shared/camera.ts's classifyCameraError()/describeError() as-is, since
 * getUserMedia's DOMException vocabulary is identical for audio and video
 * -- this module is only for the ongoing recognition session's own errors.
 */

export type SpeechRecognitionResultStatus =
  | "granted"
  | "denied"
  | "no_speech"
  | "no_microphone"
  | "network_error"
  | "aborted"
  | "unsupported"
  | "language_not_supported"
  | "error";

export interface SpeechRecognitionDiagnostics {
  ok: boolean;
  status: SpeechRecognitionResultStatus;
  errorCode?: string;
  errorMessage?: string;
}

/**
 * Buckets a SpeechRecognitionErrorEvent's `error` code into a status a
 * caller can react to meaningfully. See
 * https://developer.mozilla.org/docs/Web/API/SpeechRecognitionErrorEvent/error
 * for the full code list -- only the ones SignSync distinguishes are
 * mapped explicitly; anything else falls back to "error".
 */
export function classifySpeechRecognitionError(errorCode: string): SpeechRecognitionResultStatus {
  switch (errorCode) {
    case "not-allowed":
    case "service-not-allowed":
      return "denied";
    case "no-speech":
      return "no_speech";
    case "audio-capture":
      return "no_microphone";
    case "network":
      return "network_error";
    case "aborted":
      return "aborted";
    case "language-not-supported":
      // Phase 10 Part 8: the browser recognized the request but cannot run
      // SpeechRecognition in the requested language -- distinct from a
      // generic "error" so the UI can show a clear, specific message
      // ("Live captions are unavailable for this language in your
      // browser.") instead of a raw technical error.
      return "language_not_supported";
    default:
      return "error";
  }
}

/** True if `window` exposes either the standard or vendor-prefixed
 *  SpeechRecognition constructor. False (safely, no throw) in any
 *  non-browser environment, including Node/test runners. */
export function isSpeechRecognitionSupported(): boolean {
  return typeof window !== "undefined" && !!(window.SpeechRecognition || window.webkitSpeechRecognition);
}
