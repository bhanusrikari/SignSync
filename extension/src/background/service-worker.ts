import { getState, updateState } from "@/services/storage";
import { broadcastToTabs } from "@/utils/messaging";
import type { LanguageCode, SignSyncMessage, SignSyncState, StateUpdatedMessage } from "@/types";
import type { CameraDiagnostics } from "@/shared/camera";

/** Persists `partial`, then relays the resulting state to every tab's content script. */
async function applyAndBroadcast(
  partial: Partial<SignSyncState>,
): Promise<SignSyncState> {
  const previous = await getState();
  const next = await updateState(partial);
  const message: StateUpdatedMessage = { type: "STATE_UPDATED", payload: next };
  await broadcastToTabs(message);

  // Camera/MediaPipe and captions are independent capabilities that happen
  // to share one offscreen document (Chrome allows only one per extension
  // -- see ensureSharedOffscreenDocument()). Each gets its own start/stop
  // transition check; the shared document itself is only created when
  // either becomes needed and only destroyed when neither is (handled
  // inside stopGestureCamera()/stopCaptions() via closeSharedOffscreenDocumentIfIdle()).
  const wasCameraActive = previous.enabled && previous.gestureRecognition;
  const isCameraActive = next.enabled && next.gestureRecognition;
  if (isCameraActive && !wasCameraActive) {
    void startGestureCamera(next.language);
  } else if (!isCameraActive && wasCameraActive) {
    void stopGestureCamera();
  } else if (isCameraActive && wasCameraActive && next.language !== previous.language) {
    // Phase 11 Part B: unlike captions, personalized-gesture recognition
    // doesn't need a restart to pick up a language change -- the offscreen
    // document just needs its gestureLanguage variable updated so the
    // NEXT stable match resolves against the new language.
    void requestOffscreenGestureLanguageUpdate(next.language);
  }

  const wasCaptionsActive = previous.enabled && previous.captions;
  const isCaptionsActive = next.enabled && next.captions;
  if (isCaptionsActive && !wasCaptionsActive) {
    void startCaptions(next.language);
  } else if (!isCaptionsActive && wasCaptionsActive) {
    void stopCaptions();
  } else if (isCaptionsActive && wasCaptionsActive && next.language !== previous.language) {
    // Phase 10 Part 8: a running SpeechRecognition session doesn't pick up
    // a new .lang on its own -- restart it so changing the caption language
    // while captions are already on actually takes effect, not just on the
    // next captions off->on toggle.
    void stopCaptions().then(() => startCaptions(next.language));
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

      case "PERSONALIZED_GESTURE_DETECTED":
        // Same required relay as GESTURE_DETECTED, for the independent
        // personalized-gesture detection path (Phase 9).
        broadcastToTabs(message).then(() => sendResponse({ ok: true }));
        return true;

      case "CAPTION_UPDATE":
        // Same required relay as GESTURE_DETECTED, for the live-captions
        // pipeline's SpeechRecognition results.
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

// --- Offscreen document lifecycle (camera/gestures + live captions) -----
// Both capabilities' permission/start/stop lifecycle, sharing one offscreen
// document. Triggered automatically by the Gesture Recognition / Live
// Captions toggles above; also exposed on globalThis for manual testing
// from this service worker's DevTools console.

const OFFSCREEN_URL = "offscreen.html";
const PERMISSION_URL = "permission.html";

/** Tab ids of open permission tabs, if any -- avoids opening a second one
 *  of the same kind while the user is still responding to the first.
 *  Camera and microphone are tracked separately since both can plausibly
 *  be needed at once (e.g. enabling Accessibility for the first time with
 *  both Gesture Recognition and Captions already on). Reset on MV3 service
 *  worker restart, which just means a fresh tab could be opened if the user
 *  re-triggers the flow; a stale tab (if still open) still works fine. */
let cameraPermissionTabId: number | undefined;
let microphonePermissionTabId: number | undefined;

/** Creates the shared offscreen document (camera/MediaPipe AND captions
 *  both live in it -- Chrome allows only one per extension) if it doesn't
 *  already exist. Idempotent and safe to call from both capabilities'
 *  start paths concurrently: if two callers race and Chrome rejects the
 *  second createDocument() because the first already succeeded, that's
 *  treated as success rather than a real failure. */
async function ensureSharedOffscreenDocument(): Promise<
  { ok: true } | { ok: false; error: string }
> {
  try {
    if (!(await chrome.offscreen.hasDocument())) {
      await chrome.offscreen.createDocument({
        url: OFFSCREEN_URL,
        reasons: [chrome.offscreen.Reason.USER_MEDIA],
        justification: "Camera access for SignSync gesture recognition and microphone access for live captions.",
      });
      console.log("[SignSync] offscreen document created");
    }
    return { ok: true };
  } catch (error) {
    if (await chrome.offscreen.hasDocument()) return { ok: true }; // lost a creation race, not a real failure
    const message = error instanceof Error ? error.message : String(error);
    console.error("[SignSync] chrome.offscreen.createDocument failed:", error);
    return { ok: false, error: message };
  }
}

/** Closes the shared offscreen document only if NEITHER capability that
 *  depends on it is still supposed to be active -- re-reads persisted
 *  state rather than trusting a snapshot, so this is correct even if
 *  called from two concurrent stop paths (e.g. disabling Accessibility
 *  while both Gesture Recognition and Captions were on). */
async function closeSharedOffscreenDocumentIfIdle(): Promise<void> {
  const state = await getState();
  const cameraNeeded = state.enabled && state.gestureRecognition;
  const captionsNeeded = state.enabled && state.captions;
  if (cameraNeeded || captionsNeeded) {
    console.log("[SignSync] offscreen document still needed by the other capability, keeping it alive");
    return;
  }
  if (!(await chrome.offscreen.hasDocument())) return;
  try {
    await chrome.offscreen.closeDocument();
    console.log("[SignSync] shared offscreen document closed (no capability needs it anymore)");
  } catch (error) {
    console.warn("[SignSync] closeDocument failed (possibly already closed):", error);
  }
}

async function requestOffscreenCameraStart(language: LanguageCode): Promise<CameraDiagnostics | undefined> {
  try {
    const result = (await chrome.runtime.sendMessage({
      type: "GESTURE_CAMERA_START",
      payload: { language },
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

/** Updates the offscreen document's gestureLanguage without restarting the
 *  camera/hand-tracking loop (Phase 11 Part B) -- called when the
 *  interface language changes while gesture recognition is already active.
 *  Swallowed-and-logged like every other offscreen relay here: a failed
 *  update just means the next personalized-gesture meaning resolves in the
 *  previous language until the document is next reached, never a crash. */
async function requestOffscreenGestureLanguageUpdate(language: LanguageCode): Promise<void> {
  try {
    await chrome.runtime.sendMessage({ type: "GESTURE_LANGUAGE_UPDATE", payload: { language } });
  } catch (error) {
    console.warn("[SignSync] offscreen document did not respond to GESTURE_LANGUAGE_UPDATE:", error);
  }
}

/** Opens (or focuses an already-open) visible permission tab for the given
 *  device kind. Camera and microphone are tracked as separate pending tabs
 *  since both can legitimately be needed at once. */
async function openPermissionTab(kind: "camera" | "microphone"): Promise<void> {
  const existingTabId = kind === "microphone" ? microphonePermissionTabId : cameraPermissionTabId;
  if (existingTabId !== undefined) {
    try {
      await chrome.tabs.update(existingTabId, { active: true });
      return;
    } catch {
      // tab no longer exists, fall through to open a fresh one
    }
  }
  const tab = await chrome.tabs.create({ url: `${PERMISSION_URL}?kind=${kind}` });
  if (kind === "microphone") microphonePermissionTabId = tab.id;
  else cameraPermissionTabId = tab.id;
}

/** Enable path: try a silent camera start first (permission may already be
 *  granted from a previous session); only fall back to the interactive
 *  permission tab if that fails for a permission-shaped reason. */
async function startGestureCamera(language: LanguageCode = "en-IN"): Promise<void> {
  const creation = await ensureSharedOffscreenDocument();
  if (!creation.ok) return;

  const result = await requestOffscreenCameraStart(language);
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
  await openPermissionTab("camera");
}

async function stopGestureCamera(): Promise<void> {
  if (!(await chrome.offscreen.hasDocument())) return;
  try {
    await chrome.runtime.sendMessage({ type: "GESTURE_CAMERA_STOP" });
  } catch (error) {
    console.warn("[SignSync] offscreen document did not respond to GESTURE_CAMERA_STOP:", error);
  }
  await closeSharedOffscreenDocumentIfIdle();
}

async function requestOffscreenCaptionsStart(
  language: LanguageCode,
): Promise<{ ok: boolean; status: string; errorMessage?: string } | undefined> {
  try {
    const result = (await chrome.runtime.sendMessage({ type: "CAPTIONS_START", payload: { language } })) as
      | { ok: boolean; status: string; errorMessage?: string }
      | undefined;
    console.log("[SignSync] offscreen captions start result:", result);
    return result;
  } catch (error) {
    console.error("[SignSync] offscreen document did not respond to CAPTIONS_START:", error);
    return undefined;
  }
}

/** Enable path for Live Captions -- same silent-first, permission-tab-
 *  fallback shape as startGestureCamera(), but for the microphone and a
 *  browser-support check instead of the camera. `language` (Phase 10 Part
 *  8) configures the browser SpeechRecognition session's recognition
 *  language -- see offscreen.ts's startCaptions(), which is the only place
 *  that actually sets `.lang` on the instance. */
async function startCaptions(language: LanguageCode): Promise<void> {
  const creation = await ensureSharedOffscreenDocument();
  if (!creation.ok) return;

  const result = await requestOffscreenCaptionsStart(language);
  if (result?.ok) {
    console.log("[SignSync] captions active (permission already granted)");
    return;
  }

  if (result?.status === "denied") {
    console.warn(
      "[SignSync] microphone permission previously denied -- not opening the permission tab " +
        "automatically. The user must re-allow it via chrome://settings/content/microphone.",
    );
    return;
  }

  if (result?.status === "unsupported") {
    console.warn("[SignSync] SpeechRecognition is not supported in this browser -- captions unavailable.");
    return;
  }

  console.log("[SignSync] captions need interactive microphone permission, opening permission tab", result);
  await openPermissionTab("microphone");
}

async function stopCaptions(): Promise<void> {
  if (!(await chrome.offscreen.hasDocument())) return;
  try {
    await chrome.runtime.sendMessage({ type: "CAPTIONS_STOP" });
  } catch (error) {
    console.warn("[SignSync] offscreen document did not respond to CAPTIONS_STOP:", error);
  }
  await closeSharedOffscreenDocumentIfIdle();
}

// The permission tab reports its result here once the user has responded to
// the prompt. On success, retry starting the (already-open) offscreen
// document's camera capture -- permission granted to the extension's origin
// from any of its pages is available to all of them.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "CAMERA_PERMISSION_RESULT") return false;

  const result = message.payload as CameraDiagnostics;
  console.log("[SignSync] camera permission tab reported:", result);

  if (sender.tab?.id !== undefined && sender.tab.id === cameraPermissionTabId) {
    cameraPermissionTabId = undefined;
  }

  if (result.ok) {
    getState().then((state) => requestOffscreenCameraStart(state.language)).then(sendResponse);
    return true;
  }

  sendResponse({ acknowledged: true });
  return false;
});

// Same pattern as CAMERA_PERMISSION_RESULT above, for the microphone tab.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "MICROPHONE_PERMISSION_RESULT") return false;

  const result = message.payload as CameraDiagnostics;
  console.log("[SignSync] microphone permission tab reported:", result);

  if (sender.tab?.id !== undefined && sender.tab.id === microphonePermissionTabId) {
    microphonePermissionTabId = undefined;
  }

  if (result.ok) {
    getState().then((state) => requestOffscreenCaptionsStart(state.language)).then(sendResponse);
    return true;
  }

  sendResponse({ acknowledged: true });
  return false;
});

// Exposed for manual testing from this service worker's DevTools console.
Object.assign(globalThis, { startGestureCamera, stopGestureCamera, startCaptions, stopCaptions });
