/**
 * Owns camera capture for SignSync gesture recognition, and -- once the
 * camera is running -- hand-landmark detection against that same stream (see
 * gesture-recognition plan). No gesture classification, feature extraction,
 * or smoothing yet: this only proves camera-in, landmarks-out. Started/
 * stopped by the background service worker via GESTURE_CAMERA_START /
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
import { detectHands, disposeHandTracker, isHandTrackerLoaded, loadHandTracker } from "@/ai/handTracker";

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
        const wrist = result.landmarks[0][0];
        console.log(
          `[SignSync] hand detected: ${result.handsDetected} hand(s), ` +
            `21 landmarks each. wrist=(${wrist.x.toFixed(3)}, ${wrist.y.toFixed(3)}, ${wrist.z.toFixed(3)})`,
        );
        setStatus(`Hand detected (${result.handsDetected})`);
      } else {
        console.log("[SignSync] no hand detected");
        setStatus("No hand detected");
      }
    } catch (error) {
      console.error("[SignSync] detectHands failed:", error);
    }
  }, DETECTION_INTERVAL_MS);
}

function stopHandTracking(): void {
  if (detectionTimer !== undefined) {
    clearInterval(detectionTimer);
    detectionTimer = undefined;
  }
  disposeHandTracker();
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

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "GESTURE_CAMERA_START") {
    startCamera().then(sendResponse);
    return true; // async response
  }
  if (message?.type === "GESTURE_CAMERA_STOP") {
    sendResponse(stopCamera());
    return false;
  }
  return false;
});

setStatus("Offscreen document ready");
