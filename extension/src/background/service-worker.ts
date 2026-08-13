import { getState, updateState } from "@/services/storage";
import { broadcastToTabs } from "@/utils/messaging";
import type { SignSyncMessage, SignSyncState, StateUpdatedMessage } from "@/types";

/** Persists `partial`, then relays the resulting state to every tab's content script. */
async function applyAndBroadcast(
  partial: Partial<SignSyncState>,
): Promise<SignSyncState> {
  const next = await updateState(partial);
  const message: StateUpdatedMessage = { type: "STATE_UPDATED", payload: next };
  await broadcastToTabs(message);
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

      default:
        return false;
    }
  },
);

chrome.runtime.onInstalled.addListener(() => {
  // Ensure a state record exists in storage from the very first run.
  getState();
});
