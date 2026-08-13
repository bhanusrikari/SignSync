import type { GestureLabel } from "@/ai/gestureTypes";

/** BCP-47 codes for the languages SignSync supports (see TECH_SPEC.md §22). */
export type LanguageCode = "en-IN" | "hi-IN" | "te-IN";

export interface OverlayPosition {
  x: number;
  y: number;
}

/**
 * Central SignSync state (TECH_SPEC.md §8), persisted via chrome.storage.local
 * and shared between the popup, background worker, and content script.
 */
export interface SignSyncState {
  enabled: boolean;
  gestureRecognition: boolean;
  captions: boolean;
  speechOutput: boolean;
  speechRecognition: boolean;
  language: LanguageCode;
  overlayPosition: OverlayPosition;
}

/** Message channel between popup, background, and content script (TECH_SPEC.md §7). */
export type MessageType =
  | "GET_STATE"
  | "SET_ENABLED"
  | "UPDATE_SETTINGS"
  | "STATE_UPDATED"
  | "GESTURE_DETECTED";

export interface GetStateMessage {
  type: "GET_STATE";
}

export interface SetEnabledMessage {
  type: "SET_ENABLED";
  payload: { enabled: boolean };
}

export interface UpdateSettingsMessage {
  type: "UPDATE_SETTINGS";
  payload: Partial<Omit<SignSyncState, "enabled">>;
}

/** Broadcast from the background worker whenever persisted state changes. */
export interface StateUpdatedMessage {
  type: "STATE_UPDATED";
  payload: SignSyncState;
}

export interface GestureDetectedPayload {
  gesture: GestureLabel;
  /** User-facing prototype-gesture text (see ai/gestureVocabulary.ts) --
   *  null when the gesture is UNKNOWN or otherwise unmapped. These are
   *  prototype gesture commands for this implementation, not formal
   *  sign-language translations. */
  text: string | null;
  /** 0..1. For UNKNOWN, this is the best (but insufficient) template match. */
  confidence: number;
  timestamp: number;
}

/**
 * Broadcast from the background worker whenever the gesture pipeline's
 * stabilized gesture changes (see ai/gestureStabilizer.ts) -- one event per
 * stable transition, not one per detection frame. `gesture: "UNKNOWN"` is a
 * real transition too (e.g. the hand left the frame), not an absence of a
 * message.
 */
export interface GestureDetectedMessage {
  type: "GESTURE_DETECTED";
  payload: GestureDetectedPayload;
}

export type SignSyncMessage =
  | GetStateMessage
  | SetEnabledMessage
  | UpdateSettingsMessage
  | StateUpdatedMessage
  | GestureDetectedMessage;

/** Messages the background worker broadcasts to every tab's content script,
 *  as opposed to request/response messages a popup or content script sends
 *  TO the background worker. */
export type BroadcastMessage = StateUpdatedMessage | GestureDetectedMessage;
