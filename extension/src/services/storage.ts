import { DEFAULT_STATE, STORAGE_KEY } from "@/shared/constants";
import type { SignSyncState } from "@/types";

/** Reads the persisted SignSync state, falling back to defaults on first run. */
export async function getState(): Promise<SignSyncState> {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  const stored = result[STORAGE_KEY] as Partial<SignSyncState> | undefined;
  return { ...DEFAULT_STATE, ...stored };
}

/** Merges `partial` into the persisted state and returns the resulting state. */
export async function updateState(
  partial: Partial<SignSyncState>,
): Promise<SignSyncState> {
  const current = await getState();
  const next: SignSyncState = { ...current, ...partial };
  await chrome.storage.local.set({ [STORAGE_KEY]: next });
  return next;
}

/** Invokes `listener` whenever the persisted SignSync state changes. */
export function onStateChanged(
  listener: (state: SignSyncState) => void,
): () => void {
  const handler = (
    changes: { [key: string]: chrome.storage.StorageChange },
    areaName: string,
  ) => {
    if (areaName !== "local" || !changes[STORAGE_KEY]) return;
    listener({ ...DEFAULT_STATE, ...changes[STORAGE_KEY].newValue });
  };
  chrome.storage.onChanged.addListener(handler);
  return () => chrome.storage.onChanged.removeListener(handler);
}
