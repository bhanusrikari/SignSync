import { getState, updateState } from "@/services/storage";
import { broadcastToTabs } from "@/utils/messaging";
import type { SignSyncMessage, SignSyncState, StateUpdatedMessage } from "@/types";
import type { CameraDiagnostics } from "@/shared/camera";

/** Persists `partial`, then relays the resulting state to every tab's content script. */
async function applyAndBroadcast(
  partial: Partial<SignSyncState>,
): Promise<SignSyncState> {
  const previous = await getState();
  const next = await updateState(partial);
  const message: StateUpdatedMessage = { type: "STATE_UPDATED", payload: next };
  await broadcastToTabs(message);

  const wasActive = previous.enabled && previous.gestureRecognition;
  const isActive = next.enabled && next.gestureRecognition;
  if (isActive && !wasActive) {
    void startGestureCamera();
  } else if (!isActive && wasActive) {
    void stopGestureCamera();
  }

  return next;
}

chrome.runtime.onMessage.addListener(
  (message: SignSyncMessage, _sender, sendResponse) => {
    switch (message.type) {
      case "GET_STATE":
        getState().then(sendResponse);
        return true; // keep the message channel open for the async response

      case "SET_ENABLED":
        applyAndBroadcast({ enabled: message.payload.enabled }).then(sendResponse);
        return true;

      case "UPDATE_SETTINGS":
        applyAndBroadcast(message.payload).then(sendResponse);
        return true;

      case "GESTURE_DETECTED":
        // Relayed from the offscreen document. chrome.runtime.sendMessage
        // can't reach a content script directly -- only chrome.tabs.sendMessage
        // can, which needs tab ids the offscreen document doesn't have. The
        // background worker is the one context that can enumerate tabs, so
        // it's a required relay here, not optional forwarding.
        broadcastToTabs(message).then(() => sendResponse({ ok: true }));
        return true;

      default:
        return false;
    }
  },
);

chrome.runtime.onInstalled.addListener(() => {
  // Ensure a state record exists in storage from the very first run.
  getState();
});

// --- Gesture-recognition camera foundation -------------------------------
// Camera permission/start/stop lifecycle only -- no MediaPipe/classification
// wired in yet (see gesture-recognition plan). Triggered automatically by
// the gestureRecognition toggle above; also exposed on globalThis for manual
// testing from this service worker's DevTools console.

const OFFSCREEN_URL = "offscreen.html";
const PERMISSION_URL = "permission.html";

/** Tab id of an open permission tab, if any -- avoids opening a second one
 *  while the user is still responding to the first. Reset on MV3 service
 *  worker restart, which just means a fresh tab could be opened if the user
 *  re-triggers the flow; the stale tab (if still open) still works fine. */
let permissionTabId: number | undefined;

async function ensureGestureOffscreenDocument(): Promise<
  { ok: true } | { ok: false; error: string }
> {
  try {
    if (!(await chrome.offscreen.hasDocument())) {
      await chrome.offscreen.createDocument({
        url: OFFSCREEN_URL,
        reasons: [chrome.offscreen.Reason.USER_MEDIA],
        justification: "Camera access for SignSync gesture recognition.",
      });
      console.log("[SignSync] offscreen document created");
    }
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[SignSync] chrome.offscreen.createDocument failed:", error);
    return { ok: false, error: message };
  }
}

async function requestOffscreenCameraStart(): Promise<CameraDiagnostics | undefined> {
  try {
    const result = (await chrome.runtime.sendMessage({
      type: "GESTURE_CAMERA_START",
    })) as CameraDiagnostics | undefined;
    console.log("[SignSync] offscreen camera start result:", result);
    return result;
  } catch (error) {
    console.error(
      "[SignSync] offscreen document did not respond to GESTURE_CAMERA_START:",
      error,
    );
    return undefined;
  }
}

async function openPermissionTab(): Promise<void> {
  if (permissionTabId !== undefined) {
    try {
      await chrome.tabs.update(permissionTabId, { active: true });
      return;
    } catch {
      permissionTabId = undefined; // tab no longer exists
    }
  }
  const tab = await chrome.tabs.create({ url: PERMISSION_URL });
  permissionTabId = tab.id;
}

/** Enable path: try a silent camera start first (permission may already be
 *  granted from a previous session); only fall back to the interactive
 *  permission tab if that fails for a permission-shaped reason. */
async function startGestureCamera(): Promise<void> {
  const creation = await ensureGestureOffscreenDocument();
  if (!creation.ok) return;

  const result = await requestOffscreenCameraStart();
  if (result?.ok) {
    console.log("[SignSync] gesture camera active (permission already granted)");
    return;
  }

  if (result?.status === "denied") {
    console.warn(
      "[SignSync] camera permission previously denied -- not opening the permission tab " +
        "automatically. The user must re-allow it via chrome://settings/content/camera.",
    );
    return;
  }

  console.log("[SignSync] camera needs interactive permission, opening permission tab", result);
  await openPermissionTab();
}

async function stopGestureCamera(): Promise<void> {
  if (!(await chrome.offscreen.hasDocument())) return;
  try {
    await chrome.runtime.sendMessage({ type: "GESTURE_CAMERA_STOP" });
  } catch (error) {
    console.warn("[SignSync] offscreen document did not respond to GESTURE_CAMERA_STOP:", error);
  }
  await chrome.offscreen.closeDocument();
  console.log("[SignSync] gesture camera stopped, offscreen document closed");
}

// The permission tab reports its result here once the user has responded to
// the prompt. On success, retry starting the (already-open) offscreen
// document's camera capture -- permission granted to the extension's origin
// from any of its pages is available to all of them.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "CAMERA_PERMISSION_RESULT") return false;

  const result = message.payload as CameraDiagnostics;
  console.log("[SignSync] permission tab reported:", result);

  if (sender.tab?.id !== undefined && sender.tab.id === permissionTabId) {
    permissionTabId = undefined;
  }

  if (result.ok) {
    requestOffscreenCameraStart().then(sendResponse);
    return true;
  }

  sendResponse({ acknowledged: true });
  return false;
});

// Exposed for manual testing from this service worker's DevTools console.
Object.assign(globalThis, { startGestureCamera, stopGestureCamera });
