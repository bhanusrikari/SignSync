/**
 * Visible, user-interactive surface for granting camera OR microphone
 * permission (see gesture-recognition plan follow-up: an offscreen
 * document cannot itself show a permission prompt). Opened by the
 * background service worker when gesture recognition or live captions is
 * enabled and the relevant permission doesn't exist yet. Which device is
 * being requested is read from the `?kind=camera|microphone` URL query
 * param the background worker sets (defaults to camera, preserving the
 * original single-purpose behavior if the param is ever missing).
 *
 * Only establishes the permission grant for this extension's origin -- the
 * offscreen document performs its own independent, longer-lived capture
 * afterward, reusing the same grant silently.
 */

import { classifyCameraError, describeError } from "@/shared/camera";
import type { CameraDiagnostics } from "@/shared/camera";

type PermissionKind = "camera" | "microphone";

function getRequestedKind(): PermissionKind {
  const params = new URLSearchParams(window.location.search);
  return params.get("kind") === "microphone" ? "microphone" : "camera";
}

const kind = getRequestedKind();

const headingEl = document.getElementById("heading");
const descriptionEl = document.getElementById("description");
const statusEl = document.getElementById("status");
const buttonEl = document.getElementById("grant") as HTMLButtonElement | null;

if (kind === "microphone") {
  if (headingEl) headingEl.textContent = "SignSync needs microphone access";
  if (descriptionEl) {
    // Deliberately NOT claiming this is private/on-device like the camera
    // copy above -- Chrome's built-in speech recognition may send audio to
    // Google's servers for processing. Honest, not reassuring-but-false.
    descriptionEl.textContent =
      "Live Captions uses your microphone to transcribe speech using your " +
      "browser's built-in speech recognition, which may send audio to " +
      "Google's servers for processing.";
  }
  if (buttonEl) buttonEl.textContent = "Grant microphone access";
}

function setStatus(text: string) {
  console.log(`[SignSync Permission] ${text}`);
  if (statusEl) statusEl.textContent = text;
}

async function requestPermission(): Promise<CameraDiagnostics> {
  const mediaDevicesExists = !!navigator.mediaDevices;
  if (!mediaDevicesExists) {
    return { ok: false, status: "unavailable", mediaDevicesExists };
  }

  // Device enumeration is camera-diagnostic-only (videoInputCount) -- not
  // meaningful for the microphone flow, so it's skipped there rather than
  // repurposing a video-named field for audio device counts.
  let videoInputCount: number | undefined;
  if (kind === "camera") {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      videoInputCount = devices.filter((d) => d.kind === "videoinput").length;
    } catch {
      // Non-fatal -- proceed to getUserMedia regardless.
    }
  }

  const startedAt = Date.now();
  try {
    const stream = await navigator.mediaDevices.getUserMedia(
      kind === "microphone" ? { audio: true } : { video: true },
    );
    // Only needed to establish the permission grant for this origin -- stop
    // immediately, the offscreen document opens its own stream afterward.
    stream.getTracks().forEach((track) => track.stop());
    return {
      ok: true,
      status: "granted",
      mediaDevicesExists,
      videoInputCount,
      elapsedMs: Date.now() - startedAt,
    };
  } catch (error) {
    const { errorName, errorMessage, errorConstructorName } = describeError(error);
    // classifyCameraError()'s DOMException vocabulary is identical for
    // audio and video getUserMedia calls -- reused as-is, no separate
    // "microphone error" classifier needed for this permission pre-check.
    const status = classifyCameraError(errorName, errorMessage);
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

async function closeThisTab(): Promise<void> {
  const tab = await chrome.tabs.getCurrent();
  if (tab?.id !== undefined) await chrome.tabs.remove(tab.id);
}

function renderResult(result: CameraDiagnostics) {
  chrome.runtime.sendMessage({
    type: kind === "microphone" ? "MICROPHONE_PERMISSION_RESULT" : "CAMERA_PERMISSION_RESULT",
    payload: result,
  });

  const deviceLabel = kind === "microphone" ? "Microphone" : "Camera";

  if (result.ok) {
    setStatus(
      `${deviceLabel} access granted. ${kind === "microphone" ? "Live captions are" : "Gesture recognition is"} starting...`,
    );
    if (buttonEl) buttonEl.disabled = true;
    setTimeout(() => void closeThisTab(), 1500);
    return;
  }

  if (buttonEl) buttonEl.disabled = false;
  const settingsPath =
    kind === "microphone" ? "chrome://settings/content/microphone" : "chrome://settings/content/camera";
  switch (result.status) {
    case "denied":
      setStatus(
        `${deviceLabel} access was denied. Allow it for SignSync under ${settingsPath}, then click the button again.`,
      );
      break;
    case "dismissed":
      setStatus("The permission prompt was dismissed without a choice. Click the button below to try again.");
      break;
    case "no_camera":
      // Status name is camera-specific for historical reasons, but
      // classifyCameraError() returns it for ANY missing getUserMedia
      // device (NotFoundError/OverconstrainedError) -- audio included.
      setStatus(`No ${deviceLabel.toLowerCase()} device was found. Connect one and try again.`);
      break;
    case "unavailable":
      setStatus(`The ${deviceLabel.toLowerCase()} is unavailable (it may be in use by another application).`);
      break;
    default:
      setStatus(`${deviceLabel} access failed: ${result.errorName ?? "Unknown error"} - ${result.errorMessage ?? ""}`);
  }
}

buttonEl?.addEventListener("click", () => {
  if (buttonEl) buttonEl.disabled = true;
  setStatus(`Requesting ${kind} access...`);
  requestPermission().then(renderResult);
});

setStatus(`Click the button to grant ${kind} access.`);
