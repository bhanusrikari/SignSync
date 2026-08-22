import { useEffect, useRef, useState } from "react";
import { Overlay } from "./Overlay";
import { DEFAULT_STATE } from "@/shared/constants";
import { sendToBackground } from "@/utils/messaging";
import { speakText, stopSpeaking } from "@/services/speech";
import { getLocalizedGestureText } from "@/ai/gestureVocabulary";
import {
  appendConversationEntry,
  gestureConversationEntry,
  personalizedConversationEntry,
  speechConversationEntry,
} from "./conversationEntry";
import type {
  CaptionUpdatePayload,
  ConversationEntry,
  GestureDetectedPayload,
  OverlayPosition,
  PersonalizedGestureDetectedPayload,
  SignSyncMessage,
  SignSyncState,
} from "@/types";

/** Bounded "Conversation" panel shown in the overlay (Phase 10.1 Part 4,
 *  TECH_SPEC.md §24's ConversationEntry model). Session-only presentation
 *  state -- deliberately NOT persisted to chrome.storage.local: PRD.md §19
 *  says the extension "can OPTIONALLY maintain recognized communication"
 *  (never "must persist across sessions"), and the existing overlay's
 *  entire design already treats a re-enable as a fresh session (state,
 *  gesture, and captions are all cleared on re-enable too -- see the
 *  STATE_UPDATED handler below). Kept here rather than shared/constants.ts
 *  or ai/gestureConstants.ts for the same reason as before: this is
 *  presentation state, not an AI-pipeline tuning constant. */
const MAX_HISTORY = 6;

export function OverlayRoot() {
  const [state, setState] = useState<SignSyncState>(DEFAULT_STATE);
  const [gesture, setGesture] = useState<GestureDetectedPayload | null>(null);
  // Debug-only display of the most recent PERSONALIZED_GESTURE_DETECTED
  // (Phase 9) -- proves the real-camera -> matcher -> stabilizer -> message
  // path works end to end. Independent of `gesture` above: it is never
  // cleared by a "no match" transition (there isn't one to listen for --
  // see personalizedGestureStabilizer.ts's header), only by recognition
  // being turned off, same as `gesture`.
  const [personalizedGesture, setPersonalizedGesture] = useState<PersonalizedGestureDetectedPayload | null>(null);
  const [history, setHistory] = useState<ConversationEntry[]>([]);
  const [caption, setCaption] = useState<CaptionUpdatePayload | null>(null);
  // The message listener below is registered once (empty deps, see the
  // effect it lives in) and needs the CURRENT language when a
  // GESTURE_DETECTED message arrives, not whatever `state.language` was
  // when the listener was first attached -- a ref sidesteps that stale-
  // closure gap without re-subscribing chrome.runtime.onMessage every time
  // the language changes.
  const currentLanguageRef = useRef(state.language);
  useEffect(() => {
    currentLanguageRef.current = state.language;
  }, [state.language]);

  useEffect(() => {
    sendToBackground<SignSyncState>({ type: "GET_STATE" }).then(setState);

    const handleMessage = (message: SignSyncMessage) => {
      if (message.type === "STATE_UPDATED") {
        setState(message.payload);
        const isActive = message.payload.enabled && message.payload.gestureRecognition;
        // Clear any stale gesture / history / in-flight speech the instant
        // recognition turns off, so re-enabling never briefly shows or
        // speaks a leftover result from before, and starts a fresh history
        // session rather than continuing a stale one.
        if (!isActive) {
          setGesture(null);
          setPersonalizedGesture(null);
          setHistory([]);
          stopSpeaking();
        }
        // Speech Output turned off mid-utterance must stop immediately.
        if (!message.payload.speechOutput) stopSpeaking();
        // Clear any stale caption the instant Live Captions turns off, so
        // re-enabling never briefly shows a leftover transcript from before.
        if (!(message.payload.enabled && message.payload.captions)) setCaption(null);
        return;
      }
      if (message.type === "GESTURE_DETECTED") {
        setGesture(message.payload);
        // Only recognized (non-UNKNOWN, mapped) gestures join the
        // conversation -- one stable transition, courtesy of
        // GestureStabilizer, is one GESTURE_DETECTED message, so this
        // appends at most once per transition with no extra de-duplication
        // needed here.
        const entry = gestureConversationEntry(message.payload, currentLanguageRef.current);
        if (entry) setHistory((prev) => appendConversationEntry(prev, entry, MAX_HISTORY));
        return;
      }
      if (message.type === "PERSONALIZED_GESTURE_DETECTED") {
        // User-facing display (Phase 9/10): name + meaning + confidence
        // only -- no gestureId/distance in Overlay.tsx. Also drives the
        // personalized-speech effect below, and (Phase 10.1) now joins the
        // conversation too -- a personalized gesture is a real recognized
        // gesture event just like a built-in one.
        setPersonalizedGesture(message.payload);
        const entry = personalizedConversationEntry(message.payload);
        setHistory((prev) => appendConversationEntry(prev, entry, MAX_HISTORY));
        return;
      }
      if (message.type === "CAPTION_UPDATE") {
        // Current-line-only display, unchanged -- but a FINAL (settled,
        // non-interim) caption now also joins the conversation (Phase 10.1
        // Part 4). Interim results and the "language unsupported" sentinel
        // never join -- only genuine settled speech.
        setCaption(message.payload);
        const entry = speechConversationEntry(message.payload, currentLanguageRef.current);
        if (entry) setHistory((prev) => appendConversationEntry(prev, entry, MAX_HISTORY));
      }
    };
    chrome.runtime.onMessage.addListener(handleMessage);
    return () => chrome.runtime.onMessage.removeListener(handleMessage);
  }, []);

  // Speak once per STABLE gesture transition. Deliberately keyed on
  // `gesture` alone (not state.speechOutput/state.language) so toggling
  // Speech Output or changing language never retroactively (re-)speaks the
  // gesture that's already displayed -- only a genuinely NEW GESTURE_DETECTED
  // event triggers this. React always re-runs this with the latest render's
  // closure once `gesture` changes, so state.speechOutput/state.language are
  // still current at that point despite not being listed as dependencies.
  // Speaks the LOCALIZED text (Phase 10 Part 9/10), derived from the
  // gesture LABEL rather than the message's own (always-English) `text`.
  useEffect(() => {
    if (!gesture || gesture.gesture === "UNKNOWN") return;
    if (!state.speechOutput) return;
    const localized = getLocalizedGestureText(gesture.gesture, state.language);
    if (!localized) return;
    speakText(localized, state.language);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gesture]);

  // Speak once per STABLE PERSONALIZED gesture transition (Phase 10 Part
  // 10 -- previously personalized gestures were displayed but never
  // spoken). Same dedup guarantee as the built-in effect above: this only
  // re-runs when `personalizedGesture` itself changes, and
  // PersonalizedGestureStabilizer (see ai/personalizedGestureStabilizer.ts)
  // only emits PERSONALIZED_GESTURE_DETECTED on an actual transition into a
  // newly-stable match -- never once per frame -- so this can never spam
  // speech for a gesture the user is still holding.
  useEffect(() => {
    if (!personalizedGesture) return;
    if (!state.speechOutput) return;
    // Phase 11 Part B: personalizedGesture.meaning is already resolved to
    // personalizedGesture.language by offscreen.ts -- speak in THAT
    // language, not state.language, so speech always matches the text
    // actually displayed even if the interface language changed in
    // between.
    speakText(personalizedGesture.meaning, personalizedGesture.language);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [personalizedGesture]);

  if (!state.enabled) return null;

  const handleDisable = () => {
    sendToBackground({ type: "SET_ENABLED", payload: { enabled: false } });
  };

  const handlePositionChange = (overlayPosition: OverlayPosition) => {
    sendToBackground({ type: "UPDATE_SETTINGS", payload: { overlayPosition } });
  };

  // Clears only the recent-gesture history -- the current gesture display
  // and everything else (camera, recognition, speech, settings) is
  // untouched.
  const handleClearHistory = () => setHistory([]);

  return (
    <Overlay
      state={state}
      gesture={gesture}
      personalizedGesture={personalizedGesture}
      history={history}
      caption={caption}
      onClearHistory={handleClearHistory}
      onDisable={handleDisable}
      onPositionChange={handlePositionChange}
    />
  );
}
