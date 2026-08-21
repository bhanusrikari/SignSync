/**
 * Owns camera capture for SignSync gesture recognition, hand-landmark
 * detection against that stream, and (new) turning those landmarks into a
 * stabilized gesture via the feature-extraction -> classification ->
 * temporal-stabilization pipeline in src/ai/gesture*. Started/stopped by
 * the background service worker via GESTURE_CAMERA_START /
 * GESTURE_CAMERA_STOP, in response to the Gesture Recognition toggle in the
 * popup.
 *
 * This document is invisible and cannot itself prompt for camera
 * permission -- Chrome has no window to anchor the prompt to, which
 * surfaces as NotAllowedError "Permission dismissed". Permission must
 * already be granted to this extension's origin (established via the
 * visible permission tab, see src/permission/) before this call succeeds.
 */

import { classifyCameraError, describeError } from "@/shared/camera";
import type { CameraDiagnostics } from "@/shared/camera";
import { classifySpeechRecognitionError } from "@/shared/speechRecognitionErrors";
import { accumulateTranscript } from "@/shared/captionTranscript";
import type { CaptionResultLike } from "@/shared/captionTranscript";
import { detectHands, disposeHandTracker, isHandTrackerLoaded, loadHandTracker } from "@/ai/handTracker";
import { extractHandFeatures } from "@/ai/gestureFeatures";
import { RuleBasedGestureClassifier } from "@/ai/gestureClassifier";
import { GestureStabilizer } from "@/ai/gestureStabilizer";
import { mapToRecognizedGestureText } from "@/ai/gestureVocabulary";
import type { GestureClassifier, StableGestureEvent } from "@/ai/gestureTypes";
import type { CaptionUpdateMessage, GestureDetectedMessage } from "@/types";

// Long-lived: constructed once, reused across every detection tick (and
// across stop/start cycles -- reset() clears history, not the instances).
const gestureClassifier: GestureClassifier = new RuleBasedGestureClassifier();
const gestureStabilizer = new GestureStabilizer();

/**
 * Called once per STABLE gesture transition (never per detection frame --
 * see GestureStabilizer). Maps the gesture to its user-facing text (see
 * gestureVocabulary.ts), logs for local diagnostics, and relays a
 * GESTURE_DETECTED message through the background worker so the content
 * script's overlay can display it. A delivery failure here (e.g. the
 * background worker restarting) must never stop hand tracking or the
 * camera -- it's just swallowed with a warning.
 */
function handleStableGestureEvent(event: StableGestureEvent): void {
  const recognized = mapToRecognizedGestureText(event);

  if (recognized.gesture === "UNKNOWN") {
    console.log("[SignSync] Gesture unknown");
  } else {
    console.log(
      `[SignSync] Gesture detected:\ngesture=${recognized.gesture}\ntext=${recognized.text}\n` +
        `confidence=${recognized.confidence.toFixed(2)}`,
    );
  }

  const message: GestureDetectedMessage = { type: "GESTURE_DETECTED", payload: recognized };
  chrome.runtime.sendMessage(message).catch((error) => {
    console.warn("[SignSync] failed to send GESTURE_DETECTED:", error);
  });
}

/** How often to run hand detection against the current video frame.
 *  Not tied to a render loop -- this document draws nothing but the raw
 *  camera preview, so a plain interval is enough (~8 detections/sec). */
const DETECTION_INTERVAL_MS = 120;

let activeStream: MediaStream | null = null;
let detectionTimer: number | undefined;

const statusEl = document.getElementById("status");
const videoEl = document.getElementById("preview") as HTMLVideoElement | null;

function setStatus(text: string) {
  console.log(`[SignSync] ${text}`);
  if (statusEl) statusEl.textContent = text;
}

function waitForVideoReady(video: HTMLVideoElement): Promise<void> {
  if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) return Promise.resolve();
  return new Promise((resolve) => {
    video.addEventListener("loadeddata", () => resolve(), { once: true });
  });
}

/** Loads the hand-tracking model (if needed) and starts the detection loop
 *  against `videoEl`. Runs independently of the GESTURE_CAMERA_START
 *  response so a slow model load never delays that response. */
async function startHandTracking(): Promise<void> {
  if (!videoEl) return;

  setStatus("Loading hand-tracking model...");
  try {
    await loadHandTracker();
  } catch (error) {
    const { errorMessage } = describeError(error);
    console.error("[SignSync] loadHandTracker failed:", error);
    setStatus(`Hand-tracking model failed to load: ${errorMessage}`);
    return;
  }

  await waitForVideoReady(videoEl);
  setStatus("Hand tracking active");

  detectionTimer = window.setInterval(() => {
    if (!videoEl) return;
    try {
      const result = detectHands(videoEl, performance.now());
      if (result.handsDetected > 0) {
        // Single-hand classifier: use the first detected hand only. MediaPipe
        // is already configured with numHands:1 (see handTracker.ts), so this
        // is currently the only hand present, but the choice is documented
        // explicitly since nothing here assumes that stays true forever.
        const handLandmarks = result.landmarks[0];
        const wrist = handLandmarks[0];
        console.log(
          `[SignSync] hand detected: ${result.handsDetected} hand(s), ` +
            `21 landmarks each. wrist=(${wrist.x.toFixed(3)}, ${wrist.y.toFixed(3)}, ${wrist.z.toFixed(3)})`,
        );
        setStatus(`Hand detected (${result.handsDetected})`);

        const features = extractHandFeatures(handLandmarks);
        const classification = gestureClassifier.classify(features);
        const stableEvent = gestureStabilizer.push(classification, Date.now());
        if (stableEvent) handleStableGestureEvent(stableEvent);
      } else {
        console.log("[SignSync] no hand detected");
        setStatus("No hand detected");

        // Feed an UNKNOWN frame so a previously-stable gesture correctly
        // decays once the hand leaves the frame, instead of staying stuck.
        const stableEvent = gestureStabilizer.push({ gesture: "UNKNOWN", confidence: 0 }, Date.now());
        if (stableEvent) handleStableGestureEvent(stableEvent);
      }
    } catch (error) {
      console.error("[SignSync] gesture pipeline tick failed:", error);
    }
  }, DETECTION_INTERVAL_MS);
}

function stopHandTracking(): void {
  if (detectionTimer !== undefined) {
    clearInterval(detectionTimer);
    detectionTimer = undefined;
  }
  disposeHandTracker();
  gestureStabilizer.reset();
}

async function startCamera(): Promise<CameraDiagnostics> {
  const mediaDevicesExists = !!navigator.mediaDevices;
  if (!mediaDevicesExists) {
    setStatus("navigator.mediaDevices is unavailable in this context");
    return { ok: false, status: "unavailable", mediaDevicesExists };
  }

  if (activeStream) {
    setStatus("Camera already active");
    if (!isHandTrackerLoaded()) void startHandTracking();
    return { ok: true, status: "granted", mediaDevicesExists };
  }

  let videoInputCount: number | undefined;
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    videoInputCount = devices.filter((d) => d.kind === "videoinput").length;
  } catch {
    // Non-fatal -- proceed to getUserMedia regardless.
  }

  const startedAt = Date.now();
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true });
    activeStream = stream;
    if (videoEl) videoEl.srcObject = stream;
    const track = stream.getVideoTracks()[0];
    setStatus(`Camera active: ${track?.label ?? "unknown device"}`);
    // Fire-and-forget: model loading can take a second or two and must not
    // delay the GESTURE_CAMERA_START response the background worker awaits.
    void startHandTracking();
    return {
      ok: true,
      status: "granted",
      mediaDevicesExists,
      videoInputCount,
      elapsedMs: Date.now() - startedAt,
    };
  } catch (error) {
    const { errorName, errorMessage, errorConstructorName } = describeError(error);
    const status = classifyCameraError(errorName, errorMessage);
    setStatus(`Camera failed: ${errorName ?? errorConstructorName ?? "Error"}: ${errorMessage}`);
    return {
      ok: false,
      status,
      stage: "getUserMedia",
      mediaDevicesExists,
      videoInputCount,
      errorName,
      errorMessage,
      errorConstructorName,
      elapsedMs: Date.now() - startedAt,
    };
  }
}

function stopCamera(): { ok: true } {
  stopHandTracking();
  if (!activeStream) {
    setStatus("No active camera to stop");
    return { ok: true };
  }
  activeStream.getTracks().forEach((track) => track.stop());
  activeStream = null;
  if (videoEl) videoEl.srcObject = null;
  setStatus("Camera stopped");
  return { ok: true };
}

// --- Live captions (SpeechRecognition) -----------------------------------
// Independent capability sharing this same offscreen document with the
// camera/MediaPipe pipeline above (Chrome allows only one offscreen
// document per extension). Owns its own microphone capture + recognition
// session; never touches activeStream, the hand tracker, the classifier,
// or the stabilizer. Started/stopped by the background service worker via
// CAPTIONS_START / CAPTIONS_STOP, in response to the Live Captions toggle.

let captionsActive = false;
let shouldRestartRecognition = false;
let recognition: SpeechRecognition | null = null;
/** Accumulated finalized transcript for the CURRENT captions session (see
 *  accumulateTranscript() in shared/captionTranscript.ts). Persists across
 *  automatic onend restarts below -- a new SpeechRecognition instance's own
 *  results start over from index 0, but the session's finalized text must
 *  not be lost when that happens. Reset only when startCaptions() begins a
 *  genuinely new session, never by the automatic restart in onend. */
let finalTranscript = "";

function getSpeechRecognitionConstructor(): (new () => SpeechRecognition) | undefined {
  return window.SpeechRecognition ?? window.webkitSpeechRecognition;
}

function sendCaptionUpdate(text: string, isFinal: boolean): void {
  const message: CaptionUpdateMessage = {
    type: "CAPTION_UPDATE",
    payload: { text, isFinal, timestamp: Date.now() },
  };
  chrome.runtime.sendMessage(message).catch((error) => {
    console.warn("[SignSync] failed to send CAPTION_UPDATE:", error);
  });
}

/** Builds and starts one recognition session. Never call directly to
 *  "restart" -- go through startCaptions()/the onend handler below so
 *  captionsActive/shouldRestartRecognition stay authoritative. */
function startRecognitionInstance(): void {
  const SpeechRecognitionCtor = getSpeechRecognitionConstructor();
  if (!SpeechRecognitionCtor) return; // support already checked by startCaptions()

  const instance = new SpeechRecognitionCtor();
  instance.continuous = true;
  instance.interimResults = true;

  // Scoped to THIS instance -- a fresh SpeechRecognition instance (e.g.
  // after an automatic restart below) starts its own event.results back at
  // index 0, so this must not carry over from a previous instance. The
  // session-spanning accumulated text itself lives in finalTranscript
  // above, which this deliberately does NOT reset.
  let lastFinalizedIndex = -1;

  instance.onresult = (event) => {
    const results: CaptionResultLike[] = [];
    for (let i = 0; i < event.results.length; i++) {
      results.push({ isFinal: event.results[i].isFinal, transcript: event.results[i][0]?.transcript ?? "" });
    }
    const update = accumulateTranscript(finalTranscript, lastFinalizedIndex, results, event.resultIndex);
    finalTranscript = update.finalTranscript;
    lastFinalizedIndex = update.lastFinalizedIndex;
    if (!update.combinedText) return;
    sendCaptionUpdate(update.combinedText, update.isFinal);
  };

  instance.onerror = (event) => {
    const status = classifySpeechRecognitionError(event.error);
    console.warn(`[SignSync] SpeechRecognition error: ${event.error} (${status})`);
    // Permission was revoked/denied, or the microphone itself is gone
    // ("audio-capture" -> "no_microphone") -- don't keep retrying into the
    // same wall on every onend; only an explicit CAPTIONS_START (the
    // captions lifecycle being started again) re-arms restarting. "no-speech"
    // and other transient errors are NOT fatal: onend still fires next and
    // the restart logic below brings recognition back automatically as long
    // as captions are active.
    if (status === "denied" || status === "no_microphone") shouldRestartRecognition = false;
  };

  instance.onend = () => {
    recognition = null;
    if (captionsActive && shouldRestartRecognition) {
      // Chrome can end a recognition session on its own (e.g. after a
      // period of silence) even though captions are still logically
      // enabled -- restart transparently so "live" captions stay live.
      startRecognitionInstance();
    }
  };

  try {
    instance.start();
    recognition = instance;
  } catch (error) {
    console.error("[SignSync] SpeechRecognition.start() failed:", error);
    recognition = null;
  }
}

function stopRecognitionInstance(): void {
  if (!recognition) return;
  // Detach handlers first so the onend this deliberate stop triggers is
  // never mistaken for "recognition died unexpectedly, restart it".
  recognition.onresult = null;
  recognition.onerror = null;
  recognition.onend = null;
  recognition.stop();
  recognition = null;
}

/**
 * Establishes/verifies microphone permission (mirrors the camera
 * permission check: getUserMedia's DOMException vocabulary is identical
 * for audio and video, so classifyCameraError()/describeError() apply
 * as-is -- no separate "audio permission" classifier needed). The
 * throwaway stream is stopped immediately; the actual, ongoing capture is
 * owned by the SpeechRecognition instance created afterward.
 */
async function startCaptions(): Promise<{ ok: boolean; status: string; errorMessage?: string }> {
  if (!getSpeechRecognitionConstructor()) {
    console.warn("[SignSync] SpeechRecognition is not supported in this context");
    return { ok: false, status: "unsupported" };
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((track) => track.stop());
  } catch (error) {
    const { errorName, errorMessage } = describeError(error);
    const status = classifyCameraError(errorName, errorMessage);
    console.warn("[SignSync] microphone permission check failed:", errorName, errorMessage);
    return { ok: false, status, errorMessage };
  }

  // Only a genuinely new session (captions were off) starts a fresh
  // transcript -- an already-active session calling this again (or a
  // pipeline restart) must not wipe out text already accumulated.
  if (!captionsActive) finalTranscript = "";
  captionsActive = true;
  shouldRestartRecognition = true;
  if (!recognition) startRecognitionInstance();
  return { ok: true, status: "granted" };
}

function stopCaptions(): { ok: true } {
  captionsActive = false;
  shouldRestartRecognition = false;
  stopRecognitionInstance();
  return { ok: true };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "GESTURE_CAMERA_START") {
    startCamera().then(sendResponse);
    return true; // async response
  }
  if (message?.type === "GESTURE_CAMERA_STOP") {
    sendResponse(stopCamera());
    return false;
  }
  if (message?.type === "CAPTIONS_START") {
    startCaptions().then(sendResponse);
    return true; // async response
  }
  if (message?.type === "CAPTIONS_STOP") {
    sendResponse(stopCaptions());
    return false;
  }
  return false;
});

setStatus("Offscreen document ready");
