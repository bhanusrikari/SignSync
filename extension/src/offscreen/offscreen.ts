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
import { detectHands, disposeHandTracker, isHandTrackerLoaded, loadHandTracker } from "@/ai/handTracker";
import { extractHandFeatures } from "@/ai/gestureFeatures";
import { RuleBasedGestureClassifier } from "@/ai/gestureClassifier";
import { GestureStabilizer } from "@/ai/gestureStabilizer";
import { mapToRecognizedGestureText } from "@/ai/gestureVocabulary";
import { matchPersonalizedGestureRotationInvariant } from "@/ai/personalizedGestureRotation";
import { MAX_ACCEPTABLE_DISTANCE, MIN_MATCH_CONFIDENCE } from "@/ai/personalizedGestureMatcher";
import type { PersonalizedGestureMatchResult } from "@/ai/personalizedGestureMatcher";
import { PersonalizedGestureStabilizer } from "@/ai/personalizedGestureStabilizer";
import type { PersonalizedStableGestureEvent } from "@/ai/personalizedGestureStabilizer";
import { getPersonalizedGestures } from "@/services/personalizedGestures";
import { resolvePersonalizedGestureMeaning } from "@/shared/personalizedGestures";
import { DB_NAME, DB_VERSION, GESTURES_STORE } from "@/services/personalizedGesturesDb";
import { RefreshablePersonalizedGesturesLoader } from "./personalizedGesturesLoader";
import { personalizedDebug } from "./personalizedDebug";
import type { GestureClassifier, StableGestureEvent } from "@/ai/gestureTypes";
import type {
  CaptionUpdateMessage,
  GestureDetectedMessage,
  LanguageCode,
  PersonalizedGestureDetectedMessage,
} from "@/types";

// Long-lived: constructed once, reused across every detection tick (and
// across stop/start cycles -- reset() clears history, not the instances).
const gestureClassifier: GestureClassifier = new RuleBasedGestureClassifier();
const gestureStabilizer = new GestureStabilizer();

// Personalized gesture recognition (Phase 9): an entirely independent,
// PARALLEL detection path -- see personalizedGestureMatcher.ts's header.
// Never calls, replaces, or is called by gestureClassifier/gestureStabilizer
// above. Same per-frame landmarks, same detection tick, separate outcome.
const personalizedGestureStabilizer = new PersonalizedGestureStabilizer();

/** Owns the enabled personalized gestures used by live matching (Phase 9.1
 *  fix, see personalizedGesturesLoader.ts for the full rationale). Its
 *  get() is what the per-frame detection loop reads -- synchronous,
 *  side-effect-free, never touches IndexedDB -- while reload() (called from
 *  loadPersonalizedGestures() below) is what performs the actual fetch, on
 *  every recognition activation, not only the first one in this document's
 *  lifetime (Phase 9 Step 13: no DB operations in the frame loop itself). */
const personalizedGesturesLoader = new RefreshablePersonalizedGesturesLoader(async () => {
  const gestures = await getPersonalizedGestures();
  return gestures.filter((gesture) => gesture.enabled);
});

/** Loader status not owned by RefreshablePersonalizedGesturesLoader itself
 *  (it only tracks the list, not "is a reload currently in flight" / "when
 *  did one last succeed") -- tracked here purely for [PERS] LOADER
 *  diagnostics, read by no production matching logic. */
let personalizedGesturesLoading = false;
let personalizedGesturesLastSuccessAt: number | null = null;

/** Interface language to resolve a personalized gesture's localized
 *  meaning in (Phase 11 Part B) -- set from GESTURE_CAMERA_START's payload
 *  and kept current via GESTURE_LANGUAGE_UPDATE (see the message listener
 *  below), mirroring captionLanguage's role for the captions pipeline.
 *  Defaults to "en-IN" only so this module never resolves against an
 *  empty language before the first GESTURE_CAMERA_START arrives. Read only
 *  by handleStablePersonalizedGestureEvent() -- never touches matching,
 *  which is entirely language-agnostic (landmarks, not text). */
let gestureLanguage: LanguageCode = "en-IN";

function logPersonalizedLoaderState(): void {
  const gestures = personalizedGesturesLoader.get();
  personalizedDebug.loader({
    loaded: personalizedGesturesLastSuccessAt !== null,
    loading: personalizedGesturesLoading,
    lastSuccessAt: personalizedGesturesLastSuccessAt,
    count: gestures.length,
    ids: gestures.map((gesture) => gesture.id),
  });
}

/** Triggers a fresh reload via personalizedGesturesLoader. Called from
 *  startCamera() on EVERY activation (Phase 9.1 fix) -- previously this only
 *  ran when the hand tracker was first loaded, so a gesture recorded or
 *  merged in record.html/validate.html (separate documents/tabs writing
 *  straight to IndexedDB) was invisible to an already-running offscreen
 *  document's live matching until Gesture Recognition was toggled off and
 *  back on. */
async function loadPersonalizedGestures(): Promise<void> {
  personalizedGesturesLoading = true;
  logPersonalizedLoaderState(); // "loading" visible before the fetch settles
  try {
    const gestures = await personalizedGesturesLoader.reload();
    personalizedGesturesLastSuccessAt = Date.now();
    console.log(`[SignSync] loaded ${gestures.length} enabled personalized gesture(s)`);
    // Proves (every activation, not just once) that THIS offscreen document
    // is reading the exact same SignSyncDB/personalizedGestures store that
    // record.html/validate.html write to -- see personalizedGesturesDb.ts,
    // the single source of these constants everywhere in the codebase.
    personalizedDebug.db({
      dbName: DB_NAME,
      dbVersion: DB_VERSION,
      storeName: GESTURES_STORE,
      count: gestures.length,
      ids: gestures.map((gesture) => gesture.id),
      names: gestures.map((gesture) => gesture.name),
      exampleCounts: gestures.map((gesture) => gesture.examples.length),
    });
  } catch (error) {
    // RefreshablePersonalizedGesturesLoader.reload() never actually throws
    // (see its own doc comment) -- this catch exists only so a future
    // change to that contract can never silently crash hand tracking here.
    personalizedDebug.error("loadPersonalizedGestures", error);
  } finally {
    personalizedGesturesLoading = false;
    logPersonalizedLoaderState();
  }
}

/** Per-hand-detected-frame personalized diagnostics: candidate summary, the
 *  match decision with an inferred reason, and the stabilizer transition.
 *  Called once per hand-detected tick -- never on a per-frame timer -- and
 *  every branch here is read-only observation of values the production
 *  matching/stabilization code already computed; nothing here can change
 *  the outcome. */
function logPersonalizedFrame(
  match: PersonalizedGestureMatchResult,
  stableEvent: PersonalizedStableGestureEvent | null,
): void {
  const gestures = personalizedGesturesLoader.get();
  personalizedDebug.frame({
    handDetected: true,
    gestureCount: gestures.length,
    candidateIds: gestures.map((gesture) => gesture.id),
  });

  if (match.matched && match.gestureId && match.name) {
    personalizedDebug.matchAccepted({
      id: match.gestureId,
      name: match.name,
      distance: match.distance,
      confidence: match.confidence,
      threshold: MAX_ACCEPTABLE_DISTANCE,
    });
  } else {
    // Inferred reason, for diagnostics only -- reads the SAME already-
    // exported threshold constants the matcher itself uses (never
    // duplicated/reimplemented logic), so this can never disagree with the
    // matcher's actual decision.
    let reason: string;
    if (gestures.length === 0) {
      reason = "no personalized gestures loaded";
    } else if (!Number.isFinite(match.distance)) {
      reason = "no usable candidate example (all malformed or contradicted)";
    } else if (match.distance > MAX_ACCEPTABLE_DISTANCE) {
      reason = "distance exceeds MAX_ACCEPTABLE_DISTANCE";
    } else if (match.confidence < MIN_MATCH_CONFIDENCE) {
      reason = "confidence below MIN_MATCH_CONFIDENCE";
    } else {
      reason = "ambiguous (within AMBIGUITY_MARGIN of the second-best candidate)";
    }
    personalizedDebug.matchRejected({
      reason,
      bestId: match.gestureId,
      bestName: match.name,
      distance: match.distance,
      confidence: match.confidence,
      threshold: MAX_ACCEPTABLE_DISTANCE,
    });
  }

  const snapshot = personalizedGestureStabilizer.getDebugSnapshot();
  personalizedDebug.stabilizer({
    incomingId: match.matched ? match.gestureId : null,
    window: snapshot.window,
    stableId: snapshot.stableId,
    emitted: stableEvent !== null,
  });
}

/** Called once per STABLE personalized-gesture transition (never per
 *  detection frame -- see PersonalizedGestureStabilizer). Logs for local
 *  diagnostics and relays a PERSONALIZED_GESTURE_DETECTED message through
 *  the background worker, exactly like handleStableGestureEvent() does for
 *  the built-in pipeline -- same required relay, same "never let a delivery
 *  failure stop hand tracking" swallow-and-warn behavior.
 *
 *  Phase 11 Part B: `event.meaning` (from PersonalizedGestureMatchResult,
 *  the protected matcher's own always-English gesture.meaning) is re-
 *  resolved here against the full PersonalizedGesture record's
 *  localizedMeanings for the current gestureLanguage before being sent --
 *  a presentation-layer override, not a matcher change. The matcher/
 *  stabilizer/rotation files are never touched; this only changes which
 *  text gets put in the OUTGOING message after they've already decided
 *  which gesture matched. */
function handleStablePersonalizedGestureEvent(event: PersonalizedStableGestureEvent): void {
  console.log(
    `[SignSync] Personalized gesture detected:\nname=${event.name}\ngestureId=${event.gestureId}\n` +
      `confidence=${event.confidence.toFixed(2)}\ndistance=${event.distance.toFixed(4)}`,
  );

  const localizedMeaning = resolvePersonalizedGestureMeaning(
    personalizedGesturesLoader.get(),
    event.gestureId,
    event.meaning,
    gestureLanguage,
  );

  const message: PersonalizedGestureDetectedMessage = {
    type: "PERSONALIZED_GESTURE_DETECTED",
    payload: {
      gestureId: event.gestureId,
      name: event.name,
      meaning: localizedMeaning,
      language: gestureLanguage,
      confidence: event.confidence,
      distance: event.distance,
      timestamp: event.timestamp,
    },
  };
  personalizedDebug.message({ sent: true, type: message.type, gestureId: event.gestureId });
  chrome.runtime.sendMessage(message).catch((error) => {
    console.warn("[SignSync] failed to send PERSONALIZED_GESTURE_DETECTED:", error);
    personalizedDebug.message({ sent: false, type: message.type, gestureId: event.gestureId });
  });
}

const NO_PERSONALIZED_MATCH: PersonalizedGestureMatchResult = {
  gestureId: null,
  name: null,
  meaning: null,
  confidence: 0,
  distance: Infinity,
  matched: false,
};

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
/** Tracks whether the PREVIOUS tick had a hand in frame, purely so the
 *  "[SignSync] hand detected" / "no hand detected" console lines below log
 *  only on a transition instead of every ~120ms tick (Phase 9.3 cleanup).
 *  null before the first tick, so the very first tick always logs once. */
let lastHandPresence: boolean | null = null;

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

  // Loaded here for the FIRST activation (cold start, before the frame loop
  // below exists yet); startCamera()'s "already active" branch (Phase 9.1
  // fix) covers every later activation. Always a one-off read outside the
  // frame loop itself (Phase 9 Step 13) -- a slow/failed load here never
  // blocks or crashes hand tracking, it just means personalized recognition
  // sits out this session.
  await loadPersonalizedGestures();

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
        // Logged only on the no-hand -> hand-detected TRANSITION (Phase 9.3
        // cleanup) -- this used to fire on every single tick (~8/sec) for as
        // long as a hand stayed in frame, drowning out everything else in
        // the console. setStatus() below still updates the visible status
        // text every tick regardless; only the console spam is throttled.
        if (lastHandPresence !== true) {
          console.log(`[SignSync] hand detected: ${result.handsDetected} hand(s), 21 landmarks each`);
        }
        lastHandPresence = true;
        setStatus(`Hand detected (${result.handsDetected})`);

        const features = extractHandFeatures(handLandmarks);

        const classification = gestureClassifier.classify(features);
        const stableEvent = gestureStabilizer.push(classification, Date.now());
        if (stableEvent) handleStableGestureEvent(stableEvent);

        // Independent personalized path: same already-extracted
        // normalizedLandmarks, the rotation-invariant matcher (validated
        // against 54 real examples -- see the Phase 8.6 report), and its own
        // stabilizer. Never influences, and is never influenced by, the
        // built-in classification/stabilization above.
        const personalizedMatch = matchPersonalizedGestureRotationInvariant(
          features.normalizedLandmarks,
          personalizedGesturesLoader.get(),
        );
        const personalizedStableEvent = personalizedGestureStabilizer.push(personalizedMatch, Date.now());
        if (personalizedStableEvent) handleStablePersonalizedGestureEvent(personalizedStableEvent);
        logPersonalizedFrame(personalizedMatch, personalizedStableEvent);
      } else {
        if (lastHandPresence !== false) {
          console.log("[SignSync] no hand detected");
        }
        lastHandPresence = false;
        setStatus("No hand detected");

        // Feed an UNKNOWN frame so a previously-stable gesture correctly
        // decays once the hand leaves the frame, instead of staying stuck.
        const stableEvent = gestureStabilizer.push({ gesture: "UNKNOWN", confidence: 0 }, Date.now());
        if (stableEvent) handleStableGestureEvent(stableEvent);

        // Same decay for the personalized path -- no event is ever emitted
        // for a transition to "no match" (see personalizedGestureStabilizer.ts),
        // this call only resets internal state so a later re-match fires
        // again. Not logged (Phase 3: personalized diagnostics are only
        // meaningful "when a hand exists") -- the stabilizer reset itself
        // still happens either way, only the [PERS] console output is
        // skipped here.
        personalizedGestureStabilizer.push(NO_PERSONALIZED_MATCH, Date.now());
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
  lastHandPresence = null;
  disposeHandTracker();
  gestureStabilizer.reset();
  personalizedGestureStabilizer.reset();
}

async function startCamera(): Promise<CameraDiagnostics> {
  const mediaDevicesExists = !!navigator.mediaDevices;
  if (!mediaDevicesExists) {
    setStatus("navigator.mediaDevices is unavailable in this context");
    return { ok: false, status: "unavailable", mediaDevicesExists };
  }

  if (activeStream) {
    setStatus("Camera already active");
    // Phase 9.1 fix: refresh personalized gestures on EVERY activation, even
    // when the hand tracker (and its detection loop) are already running --
    // awaited so the loop's very next tick reads the refreshed list, not
    // several frames later. This is the exact path that was previously
    // skipped whenever isHandTrackerLoaded() was already true, leaving a
    // stale (often empty) personalizedGestures snapshot for the rest of the
    // session. Still a single one-off read here, never a per-frame one.
    await loadPersonalizedGestures();
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
/** Language the CURRENT (or next) recognition session should use (Phase 10
 *  Part 8) -- set by startCaptions()'s caller, read by
 *  startRecognitionInstance() every time it builds a new instance, including
 *  the onend-triggered auto-restart path, which doesn't otherwise know the
 *  language at all. Defaults to "en-IN" only so this module never
 *  constructs an instance with an empty .lang before the first
 *  CAPTIONS_START arrives. */
let captionLanguage: LanguageCode = "en-IN";

function getSpeechRecognitionConstructor(): (new () => SpeechRecognition) | undefined {
  return window.SpeechRecognition ?? window.webkitSpeechRecognition;
}

function sendCaptionUpdate(
  text: string,
  isFinal: boolean,
  unsupported = false,
  unsupportedReason?: "language" | "browser" | "permission",
): void {
  const message: CaptionUpdateMessage = {
    type: "CAPTION_UPDATE",
    payload: { text, isFinal, timestamp: Date.now(), unsupported, unsupportedReason },
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
  instance.lang = captionLanguage;

  instance.onresult = (event) => {
    const result = event.results[event.resultIndex];
    const text = result?.[0]?.transcript;
    if (!text) return;
    sendCaptionUpdate(text, result.isFinal);
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
    if (status === "denied" || status === "no_microphone") {
      // Phase 11 Part C: mic access can be revoked or the device can
      // disappear WHILE captions are already running, not just at the
      // initial permission check -- without this, the overlay would just
      // silently stop updating with no explanation at all.
      shouldRestartRecognition = false;
      sendCaptionUpdate("", false, true, "permission");
    }
    if (status === "language_not_supported") {
      // Phase 10 Part 8: never expose the raw SpeechRecognition error to
      // the user, and never keep retrying into a language the browser has
      // already said it cannot recognize -- tell the content script once,
      // clearly, via the SAME channel captions already use.
      shouldRestartRecognition = false;
      sendCaptionUpdate("", false, true, "language");
    }
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
async function startCaptions(language: LanguageCode): Promise<{ ok: boolean; status: string; errorMessage?: string }> {
  captionLanguage = language;
  if (!getSpeechRecognitionConstructor()) {
    console.warn("[SignSync] SpeechRecognition is not supported in this context");
    // Phase 11 Part C: previously this left the overlay stuck on "Waiting
    // for speech..." forever with no explanation -- now it tells the user
    // plainly, through the same channel every other caption message uses.
    sendCaptionUpdate("", false, true, "browser");
    return { ok: false, status: "unsupported" };
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((track) => track.stop());
  } catch (error) {
    const { errorName, errorMessage } = describeError(error);
    const status = classifyCameraError(errorName, errorMessage);
    console.warn("[SignSync] microphone permission check failed:", errorName, errorMessage);
    // Phase 11 Part C: "denied" is the one status the service worker
    // itself treats as final (see startCaptions() there) -- every other
    // status still falls through to opening the interactive permission
    // tab, so only "denied" gets an immediate friendly overlay message
    // here; the others resolve (or don't) once the user responds to that
    // tab, same as before this change.
    if (status === "denied") {
      sendCaptionUpdate("", false, true, "permission");
    }
    return { ok: false, status, errorMessage };
  }

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
    // Phase 11 Part B: GESTURE_CAMERA_START now carries the interface
    // language (mirroring CAPTIONS_START's `language` payload below) so
    // personalized-gesture meanings can be resolved in it from the very
    // first activation -- falls back to "en-IN" for the same
    // never-silently-undefined reason CAPTIONS_START does.
    gestureLanguage = message.payload?.language ?? "en-IN";
    startCamera().then(sendResponse);
    return true; // async response
  }
  if (message?.type === "GESTURE_CAMERA_STOP") {
    sendResponse(stopCamera());
    return false;
  }
  if (message?.type === "GESTURE_LANGUAGE_UPDATE") {
    // Sent whenever SignSyncState.language changes while gesture
    // recognition is already active (Phase 11 Part B) -- unlike captions,
    // this never needs a restart: it's a plain module variable read at
    // the moment a stable personalized match is about to be sent, not a
    // SpeechRecognition instance property that only takes effect on
    // (re)construction.
    gestureLanguage = message.payload?.language ?? gestureLanguage;
    sendResponse({ ok: true });
    return false;
  }
  if (message?.type === "CAPTIONS_START") {
    // Phase 10 Part 8: CAPTIONS_START now always carries the caption
    // language the service worker resolved from SignSyncState -- falls
    // back to "en-IN" only if a caller somehow omits it (e.g. an older
    // cached message shape), never silently undefined.
    const language: LanguageCode = message.payload?.language ?? "en-IN";
    startCaptions(language).then(sendResponse);
    return true; // async response
  }
  if (message?.type === "CAPTIONS_STOP") {
    sendResponse(stopCaptions());
    return false;
  }
  return false;
});

setStatus("Offscreen document ready");
