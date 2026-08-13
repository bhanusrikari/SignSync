import { useEffect, useState } from "react";
import { Overlay } from "./Overlay";
import { DEFAULT_STATE } from "@/shared/constants";
import { sendToBackground } from "@/utils/messaging";
import type { GestureDetectedPayload, OverlayPosition, SignSyncMessage, SignSyncState } from "@/types";

export function OverlayRoot() {
  const [state, setState] = useState<SignSyncState>(DEFAULT_STATE);
  const [gesture, setGesture] = useState<GestureDetectedPayload | null>(null);

  useEffect(() => {
    sendToBackground<SignSyncState>({ type: "GET_STATE" }).then(setState);

    const handleMessage = (message: SignSyncMessage) => {
      if (message.type === "STATE_UPDATED") {
        setState(message.payload);
        // Clear any stale gesture the instant recognition turns off, so
        // re-enabling never briefly shows a leftover result from before.
        if (!message.payload.gestureRecognition) setGesture(null);
        return;
      }
      if (message.type === "GESTURE_DETECTED") {
        setGesture(message.payload);
      }
    };
    chrome.runtime.onMessage.addListener(handleMessage);
    return () => chrome.runtime.onMessage.removeListener(handleMessage);
  }, []);

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
