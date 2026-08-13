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
  | "STATE_UPDATED";

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

export type SignSyncMessage =
  | GetStateMessage
  | SetEnabledMessage
  | UpdateSettingsMessage
  | StateUpdatedMessage;
