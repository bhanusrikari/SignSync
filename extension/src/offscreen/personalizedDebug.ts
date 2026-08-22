/**
 * Structured, rate-limited diagnostics for the LIVE personalized-gesture
 * detection path (Phase 9.3) -- one consistent [PERS] prefix, one category
 * per pipeline stage, so a live console trace reads as a clean sequence
 * instead of scattered ad-hoc log lines. Pure formatting/gating logic, no
 * chrome/DOM/MediaPipe dependency, so it's unit-testable like every other
 * src/ai and src/services module in this project.
 *
 * Per-frame flooding is avoided structurally, not just by convention: there
 * is no "log every frame" method here at all. offscreen.ts (the only
 * caller) is responsible for calling these only at meaningful moments --
 * load/reload, once per hand-detected frame (not once per personalized
 * gesture checked), a match decision with its reason, a stabilizer
 * transition, and message emission -- never on an unconditional per-tick
 * timer.
 *
 * Verbosity is controlled by a single runtime flag, default ON. Toggle it
 * live from the offscreen document's DevTools console without a rebuild:
 *   window.__SIGNSYNC_PERS_DEBUG__ = false
 */

declare global {
  interface Window {
    __SIGNSYNC_PERS_DEBUG__?: boolean;
  }
}

let debugEnabledFallback = true;

/** True unless explicitly turned off via window.__SIGNSYNC_PERS_DEBUG__ =
 *  false in the offscreen document's console, or via
 *  setPersonalizedDebugEnabled() (used by tests). */
export function isPersonalizedDebugEnabled(): boolean {
  if (typeof window !== "undefined" && typeof window.__SIGNSYNC_PERS_DEBUG__ === "boolean") {
    return window.__SIGNSYNC_PERS_DEBUG__;
  }
  return debugEnabledFallback;
}

/** Test-only / console-only override for environments without a `window`
 *  global (or as a programmatic alternative to setting the window flag). */
export function setPersonalizedDebugEnabled(enabled: boolean): void {
  debugEnabledFallback = enabled;
}

function log(category: string, info: unknown): void {
  if (isPersonalizedDebugEnabled()) console.log(`[PERS] ${category}`, info);
}

export interface PersonalizedDebugDbInfo {
  dbName: string;
  dbVersion: number;
  storeName: string;
  count: number;
  ids: string[];
  names: string[];
  exampleCounts: number[];
}

export interface PersonalizedDebugLoaderInfo {
  loaded: boolean;
  loading: boolean;
  lastSuccessAt: number | null;
  count: number;
  ids: string[];
}

export interface PersonalizedDebugFrameInfo {
  handDetected: boolean;
  gestureCount: number;
  candidateIds: string[];
}

export interface PersonalizedDebugMatchAccepted {
  id: string;
  name: string;
  distance: number;
  confidence: number;
  threshold: number;
}

export interface PersonalizedDebugMatchRejected {
  reason: string;
  bestId: string | null;
  bestName: string | null;
  distance: number;
  confidence: number;
  threshold: number;
}

export interface PersonalizedDebugStabilizerInfo {
  incomingId: string | null;
  window: (string | null)[];
  stableId: string | null;
  emitted: boolean;
}

export interface PersonalizedDebugMessageInfo {
  sent: boolean;
  type: string;
  gestureId: string;
}

export const personalizedDebug = {
  db(info: PersonalizedDebugDbInfo): void {
    log("DB", info);
  },
  loader(info: PersonalizedDebugLoaderInfo): void {
    log("LOADER", info);
  },
  frame(info: PersonalizedDebugFrameInfo): void {
    log("FRAME", info);
  },
  matchAccepted(info: PersonalizedDebugMatchAccepted): void {
    log("MATCH", { ...info, accepted: true });
  },
  matchRejected(info: PersonalizedDebugMatchRejected): void {
    log("MATCH", { ...info, accepted: false });
  },
  stabilizer(info: PersonalizedDebugStabilizerInfo): void {
    log("STABILIZER", info);
  },
  message(info: PersonalizedDebugMessageInfo): void {
    log("MESSAGE", info);
  },
  error(context: string, error: unknown): void {
    // Errors always print, regardless of the debug flag -- a swallowed
    // exception must never become invisible just because verbose diagnostics
    // happen to be off.
    console.error("[PERS] ERROR", context, error);
  },
};
