import { useEffect, useState } from "react";
import { Overlay } from "./Overlay";
import { DEFAULT_STATE } from "@/shared/constants";
import { sendToBackground } from "@/utils/messaging";
import { speakText, stopSpeaking } from "@/services/speech";
import type { GestureDetectedPayload, OverlayPosition, SignSyncMessage, SignSyncState } from "@/types";

export function OverlayRoot() {
  const [state, setState] = useState<SignSyncState>(DEFAULT_STATE);
  const [gesture, setGesture] = useState<GestureDetectedPayload | null>(null);

  useEffect(() => {
    sendToBackground<SignSyncState>({ type: "GET_STATE" }).then(setState);

    const handleMessage = (message: SignSyncMessage) => {
      if (message.type === "STATE_UPDATED") {
        setState(message.payload);
        const isActive = message.payload.enabled && message.payload.gestureRecognition;
        // Clear any stale gesture / stop any in-flight speech the instant
        // recognition turns off, so re-enabling never briefly shows or
        // speaks a leftover result from before.
        if (!isActive) {
          setGesture(null);
          stopSpeaking();
        }
        // Speech Output turned off mid-utterance must stop immediately.
        if (!message.payload.speechOutput) stopSpeaking();
        return;
      }
      if (message.type === "GESTURE_DETECTED") {
        setGesture(message.payload);
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
  useEffect(() => {
    // TEMPORARY diagnostic for the "no audible speech" investigation --
    // remove once root-caused.
    console.log("[SignSync DEBUG] speak-effect fired", {
      gesture,
      speechOutput: state.speechOutput,
      language: state.language,
    });
    if (!gesture || !gesture.text) return; // UNKNOWN (or unmapped) is never spoken
    if (!state.speechOutput) return;
    speakText(gesture.text, state.language);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gesture]);

  if (!state.enabled) return null;

  const handleDisable = () => {
    sendToBackground({ type: "SET_ENABLED", payload: { enabled: false } });
  };

  const handlePositionChange = (overlayPosition: OverlayPosition) => {
    sendToBackground({ type: "UPDATE_SETTINGS", payload: { overlayPosition } });
  };

  return (
    <Overlay
      state={state}
      gesture={gesture}
      onDisable={handleDisable}
      onPositionChange={handlePositionChange}
    />
  );
}
