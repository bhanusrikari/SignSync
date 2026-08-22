import type { GestureLabel, Point3D } from "@/ai/gestureTypes";

/** BCP-47 codes for the languages SignSync supports (see TECH_SPEC.md §22). */
export type LanguageCode = "en-IN" | "hi-IN" | "te-IN";

/** Where a ConversationEntry came from (TECH_SPEC.md §24). */
export type ConversationSource = "gesture" | "speech";

/**
 * One line of the overlay's "Conversation" panel (Phase 10.1 Part 4,
 * TECH_SPEC.md §24) -- replaces the earlier plain `history: string[]` with
 * the typed shape the tech spec actually calls for. Session-only,
 * presentation state owned by content/OverlayRoot.tsx: not persisted (see
 * that file's header comment for why), not part of SignSyncState, and
 * never read by the AI/recognition pipeline.
 */
export interface ConversationEntry {
  text: string;
  source: ConversationSource;
  language: LanguageCode;
  timestamp: number;
}

export interface OverlayPosition {
  x: number;
  y: number;
}

/**
 * Central SignSync state (TECH_SPEC.md §8), persisted via chrome.storage.local
 * and shared between the popup, background worker, and content script.
 *
 * Phase 10 additions (highContrast/largeText/reducedMotion/hasSeenOnboarding/
 * developerDiagnostics) are purely additive to this record -- getState()
 * (services/storage.ts) already merges any stored (possibly older, pre-
 * Phase-10) record over shared/constants.ts's DEFAULT_STATE, so a user who
 * already has SignSync installed picks up sensible defaults for these new
 * fields automatically, with no migration step needed.
 */
export interface SignSyncState {
  enabled: boolean;
  gestureRecognition: boolean;
  captions: boolean;
  speechOutput: boolean;
  speechRecognition: boolean;
  language: LanguageCode;
  overlayPosition: OverlayPosition;
  /** Increases color contrast across the popup/dashboard/overlay (Phase 10
   *  Part 11/13 accessibility settings). */
  highContrast: boolean;
  /** Increases base text size across the popup/dashboard/overlay. */
  largeText: boolean;
  /** Minimizes motion/transition animations across the popup/dashboard/overlay. */
  reducedMotion: boolean;
  /** True once the user has completed (or explicitly skipped) the first-run
   *  onboarding screen (Phase 10 Part 14) -- the popup shows onboarding
   *  instead of the dashboard until this becomes true. */
  hasSeenOnboarding: boolean;
  /** Shows developer-only diagnostics (raw gesture IDs, matcher distances,
   *  [PERS] log explanations, etc.) in user-facing surfaces like the
   *  Validate page -- OFF by default; ordinary users should never see this
   *  (Phase 10 Part 16). Does NOT affect console logging, which is separate
   *  and always developer-only regardless of this flag. */
  developerDiagnostics: boolean;
}

/** Message channel between popup, background, and content script (TECH_SPEC.md §7). */
export type MessageType =
  | "GET_STATE"
  | "SET_ENABLED"
  | "UPDATE_SETTINGS"
  | "STATE_UPDATED"
  | "GESTURE_DETECTED"
  | "PERSONALIZED_GESTURE_DETECTED"
  | "CAPTION_UPDATE";

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

export interface PersonalizedGestureDetectedPayload {
  /** Identity, NOT the display name -- two personalized gestures can share
   *  a name (see the Phase 8.5 duplicate-name cleanup), so `gestureId` is
   *  what every consumer must key on. */
  gestureId: string;
  name: string;
  /** Already resolved to the user's current interface language (Phase 11
   *  Part B) via getLocalizedMeaning() -- see offscreen.ts's
   *  handleStablePersonalizedGestureEvent(), which looks up the full
   *  PersonalizedGesture record (for its localizedMeanings) by `gestureId`
   *  and re-resolves this field before sending, overriding the matcher's
   *  own (always-English) PersonalizedGestureMatchResult.meaning. Falls
   *  back to the gesture's default `meaning` when no translation exists for
   *  `language` -- never empty, never a raw internal id. */
  meaning: string;
  /** The language `meaning` above was resolved in -- lets every consumer
   *  (speech synthesis, conversation history) use the language that was
   *  ACTUALLY resolved at detection time rather than re-reading
   *  possibly-since-changed current UI state (Phase 11 Part B). */
  language: LanguageCode;
  /** 0..1, from PersonalizedGestureMatchResult (see
   *  ai/personalizedGestureMatcher.ts) -- the matched example's confidence
   *  at the moment this stable transition fired. */
  confidence: number;
  /** Mean per-landmark distance (same units, see
   *  ai/personalizedGestureMatcher.ts's meanLandmarkDistance) of the
   *  matched example -- lower is a closer match. */
  distance: number;
  timestamp: number;
}

/**
 * Broadcast from the background worker whenever the PERSONALIZED gesture
 * pipeline's stabilized match changes (see
 * ai/personalizedGestureStabilizer.ts) -- one message per stable transition
 * INTO a matched personalized gesture, mirroring GESTURE_DETECTED's shape
 * but entirely independent of it: this fires from a separate detection path
 * (ai/personalizedGestureRotation.ts's matchPersonalizedGestureRotationInvariant,
 * not RuleBasedGestureClassifier) and never replaces or suppresses
 * GESTURE_DETECTED. Unlike GESTURE_DETECTED, there is no "back to no match"
 * transition event -- the payload always describes an actual match.
 */
export interface PersonalizedGestureDetectedMessage {
  type: "PERSONALIZED_GESTURE_DETECTED";
  payload: PersonalizedGestureDetectedPayload;
}

export interface CaptionUpdatePayload {
  /** Current transcript chunk -- interim (still being refined) or final.
   *  Meaningless (ignored) when `unsupported` is true. */
  text: string;
  isFinal: boolean;
  timestamp: number;
  /** True whenever live captions genuinely cannot produce real transcripts
   *  right now (Phase 10 Part 8, widened in Phase 11 Part C) -- the content
   *  script shows a translated, friendly explanation instead of `text` in
   *  this case, never a raw SpeechRecognition error or DOMException. */
  unsupported?: boolean;
  /** Why `unsupported` is true (Phase 11 Part C) -- lets the content script
   *  show the CORRECT friendly reason instead of always assuming "wrong
   *  language" (the only case Phase 10 covered). "language": the browser's
   *  SpeechRecognition can't run in the selected caption language.
   *  "browser": this browser has no SpeechRecognition API at all.
   *  "permission": the microphone is unavailable or access was denied.
   *  Undefined is treated the same as "language" for backward
   *  compatibility with any consumer that only checked `unsupported`. */
  unsupportedReason?: "language" | "browser" | "permission";
}

/**
 * Broadcast from the background worker whenever the live-captions pipeline
 * (offscreen document's SpeechRecognition instance) produces a result --
 * one message per recognition result, interim or final. This is a
 * transcript of ambient/microphone speech (live captions), distinct from
 * GESTURE_DETECTED's gesture-to-text output and from the existing TTS
 * (speechSynthesis) speech *output* -- three separate capabilities that
 * happen to share similar names.
 */
export interface CaptionUpdateMessage {
  type: "CAPTION_UPDATE";
  payload: CaptionUpdatePayload;
}

export type SignSyncMessage =
  | GetStateMessage
  | SetEnabledMessage
  | UpdateSettingsMessage
  | StateUpdatedMessage
  | GestureDetectedMessage
  | PersonalizedGestureDetectedMessage
  | CaptionUpdateMessage;

/** Messages the background worker broadcasts to every tab's content script,
 *  as opposed to request/response messages a popup or content script sends
 *  TO the background worker. */
export type BroadcastMessage =
  | StateUpdatedMessage
  | GestureDetectedMessage
  | PersonalizedGestureDetectedMessage
  | CaptionUpdateMessage;

/**
 * One recorded demonstration of a personalized gesture -- a normalized
 * landmark snapshot in the same shape HandFeatures.normalizedLandmarks
 * already produces (see ai/gestureTypes.ts), never a raw camera frame,
 * MediaStream, or unprocessed MediaPipe result.
 */
export interface PersonalizedGestureExample {
  normalizedLandmarks: Point3D[];
  capturedAt: number;
}

/**
 * A user-taught gesture: a name/meaning pair plus the normalized-landmark
 * examples used to recognize it later (see ai/personalizedGestureMatcher.ts,
 * ai/personalizedGestureRotation.ts). Persisted in IndexedDB (see
 * services/personalizedGesturesDb.ts), deliberately NOT part of
 * SignSyncState -- it's a growable list of user-authored records, not a
 * settings blob.
 */
export interface PersonalizedGesture {
  id: string;
  name: string;
  /** Default/fallback meaning, shown when no localized translation exists
   *  for the user's current language -- always present, unlike
   *  localizedMeanings below. */
  meaning: string;
  /** Optional per-language spoken/displayed meaning (Phase 10 Part 9,
   *  authored via the Record page's Step 1 translation fields since Phase
   *  10.1) -- e.g. {"hi-IN": "बहुत बढ़िया!"}. Entirely additive: absent on
   *  every gesture recorded before this field existed (including real
   *  already-saved data), and getLocalizedMeaning() (see
   *  shared/personalizedGestures.ts) always falls back to `meaning` for any
   *  language missing here. Resolved into the live PERSONALIZED_GESTURE_DETECTED
   *  message's `meaning`/`language` fields by offscreen.ts (Phase 11 Part B)
   *  -- see PersonalizedGestureDetectedPayload above. */
  localizedMeanings?: Partial<Record<LanguageCode, string>>;
  examples: PersonalizedGestureExample[];
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}
