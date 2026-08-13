/**
 * Visible, user-interactive surface for granting camera permission (see
 * gesture-recognition plan follow-up: an offscreen document cannot itself
 * show a permission prompt). Opened by the background service worker when
 * gesture recognition is enabled and no camera permission exists yet.
 *
 * Only establishes the permission grant for this extension's origin -- the
 * offscreen document performs its own independent, longer-lived capture
 * afterward, reusing the same grant silently.
 */

import { classifyCameraError, describeError } from "@/shared/camera";
import type { CameraDiagnostics } from "@/shared/camera";

const statusEl = document.getElementById("status");
const buttonEl = document.getElementById("grant") as HTMLButtonElement | null;

function setStatus(text: string) {
  console.log(`[SignSync Permission] ${text}`);
  if (statusEl) statusEl.textContent = text;
}

async function requestPermission(): Promise<CameraDiagnostics> {
  const mediaDevicesExists = !!navigator.mediaDevices;
  if (!mediaDevicesExists) {
    return { ok: false, status: "unavailable", mediaDevicesExists };
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
  chrome.runtime.sendMessage({ type: "CAMERA_PERMISSION_RESULT", payload: result });

  if (result.ok) {
    setStatus("Camera access granted. Gesture recognition is starting...");
    if (buttonEl) buttonEl.disabled = true;
    setTimeout(() => void closeThisTab(), 1500);
    return;
  }

  if (buttonEl) buttonEl.disabled = false;
  switch (result.status) {
    case "denied":
      setStatus(
        "Camera access was denied. Allow it for SignSync under " +
          "chrome://settings/content/camera, then click the button again.",
      );
      break;
    case "dismissed":
      setStatus("The permission prompt was dismissed without a choice. Click the button below to try again.");
      break;
    case "no_camera":
      setStatus("No camera device was found. Connect a camera and try again.");
      break;
    case "unavailable":
      setStatus("The camera is unavailable (it may be in use by another application).");
      break;
    default:
      setStatus(`Camera access failed: ${result.errorName ?? "Unknown error"} - ${result.errorMessage ?? ""}`);
  }
}

buttonEl?.addEventListener("click", () => {
  if (buttonEl) buttonEl.disabled = true;
  setStatus("Requesting camera access...");
  requestPermission().then(renderResult);
});

setStatus("Click the button to grant camera access.");
