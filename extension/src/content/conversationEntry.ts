/**
 * Pure construction logic for the overlay's "Conversation" panel entries
 * (Phase 10.1 Part 4, TECH_SPEC.md §24). Extracted out of OverlayRoot.tsx
 * so it's unit-testable without React/DOM -- consistent with this
 * project's convention of keeping presentation LOGIC (not JSX rendering)
 * in plain, testable functions.
 */
import { getLocalizedGestureText } from "@/ai/gestureVocabulary";
import type {
  CaptionUpdatePayload,
  ConversationEntry,
  GestureDetectedPayload,
  LanguageCode,
  PersonalizedGestureDetectedPayload,
} from "@/types";

/** Builds a gesture ConversationEntry for a built-in GESTURE_DETECTED
 *  event, or null if it shouldn't join the conversation -- UNKNOWN
 *  transitions never do, matching the existing "recent history" behavior
 *  this replaces. */
export function gestureConversationEntry(
  payload: GestureDetectedPayload,
  language: LanguageCode,
): ConversationEntry | null {
  if (payload.gesture === "UNKNOWN") return null;
  const text = getLocalizedGestureText(payload.gesture, language);
  if (!text) return null;
  return { text, source: "gesture", language, timestamp: payload.timestamp };
}

/** Builds a gesture ConversationEntry for a PERSONALIZED_GESTURE_DETECTED
 *  event -- always joins (a stable personalized match is always a real
 *  recognized gesture; there is no "unmapped" case here the way UNKNOWN is
 *  for the built-in path). Uses `payload.language` (Phase 11 Part B), the
 *  language `payload.meaning` was ACTUALLY resolved in by offscreen.ts at
 *  detection time, rather than the caller's current UI language -- these
 *  can briefly disagree if the interface language changed between
 *  detection and this call, and the entry must describe what was really
 *  said, not what the UI happens to show now. */
export function personalizedConversationEntry(payload: PersonalizedGestureDetectedPayload): ConversationEntry {
  return { text: payload.meaning, source: "gesture", language: payload.language, timestamp: payload.timestamp };
}

/** Builds a speech ConversationEntry for a CAPTION_UPDATE event, or null if
 *  it shouldn't join -- interim (not yet settled) results, the
 *  language-unsupported sentinel, and empty/whitespace-only text never do. */
export function speechConversationEntry(
  payload: CaptionUpdatePayload,
  language: LanguageCode,
): ConversationEntry | null {
  if (!payload.isFinal || payload.unsupported || payload.text.trim().length === 0) return null;
  return { text: payload.text, source: "speech", language, timestamp: payload.timestamp };
}

/** Appends `entry` and trims to the most recent `maxLength` entries,
 *  oldest-first (matches the array order OverlayRoot.tsx has always used). */
export function appendConversationEntry(
  history: readonly ConversationEntry[],
  entry: ConversationEntry,
  maxLength: number,
): ConversationEntry[] {
  return [...history, entry].slice(-maxLength);
}
