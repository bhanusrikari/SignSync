import type { LanguageCode, SignSyncState } from "@/types";

/** Centralized language configuration (TECH_SPEC.md §22) so more locales can be added later. */
export const LANGUAGES: Record<string, { code: LanguageCode; name: string }> = {
  en: { code: "en-IN", name: "English" },
  hi: { code: "hi-IN", name: "Hindi" },
  te: { code: "te-IN", name: "Telugu" },
};

export const DEFAULT_STATE: SignSyncState = {
  enabled: false,
  gestureRecognition: true,
  captions: true,
  speechOutput: true,
  speechRecognition: false,
  language: "en-IN",
  overlayPosition: { x: 24, y: 24 },
};

/** Key used for the single SignSyncState record in chrome.storage.local. */
export const STORAGE_KEY = "signSyncState";
