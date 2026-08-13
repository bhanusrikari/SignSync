import type { SignSyncMessage, StateUpdatedMessage } from "@/types";

/** Sends a typed message to the background service worker and awaits its response. */
export function sendToBackground<TResponse = unknown>(
  message: SignSyncMessage,
): Promise<TResponse> {
  return chrome.runtime.sendMessage(message) as Promise<TResponse>;
}

/**
 * Broadcasts a state update to every tab's content script. Tabs without an
 * injected content script (e.g. chrome:// pages) reject — that's expected
 * and safely ignored.
 */
export async function broadcastToTabs(message: StateUpdatedMessage): Promise<void> {
  const tabs = await chrome.tabs.query({});
  await Promise.allSettled(
    tabs
      .filter((tab): tab is chrome.tabs.Tab & { id: number } => tab.id !== undefined)
      .map((tab) => chrome.tabs.sendMessage(tab.id, message)),
  );
}
