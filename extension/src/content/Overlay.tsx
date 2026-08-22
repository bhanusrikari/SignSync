import { useCallback, useRef, useState } from "react";
import type { PointerEvent } from "react";
import { Hand, Volume2, Captions, Settings, X, GripHorizontal, Mic } from "lucide-react";
import { t } from "@/i18n";
import { getLocalizedGestureText } from "@/ai/gestureVocabulary";
import type {
  CaptionUpdatePayload,
  ConversationEntry,
  GestureDetectedPayload,
  OverlayPosition,
  PersonalizedGestureDetectedPayload,
  SignSyncState,
} from "@/types";

function formatClockTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

interface OverlayProps {
  state: SignSyncState;
  /** Latest stabilized gesture event, or null if none has arrived yet
   *  (or gesture recognition is off/was just turned off). */
  gesture: GestureDetectedPayload | null;
  /** Latest stable PERSONALIZED gesture match (Phase 9), or null if none
   *  has arrived yet. Also joins `history` below (Phase 10.1) -- a
   *  personalized gesture is a real recognized gesture, not just a debug
   *  display. */
  personalizedGesture: PersonalizedGestureDetectedPayload | null;
  /** Recent conversation entries (gesture + speech), oldest first, bounded
   *  to MAX_HISTORY (see OverlayRoot.tsx). UNKNOWN gestures and interim
   *  captions are never included -- see TECH_SPEC.md §24's ConversationEntry. */
  history: ConversationEntry[];
  /** Latest live-captions transcript chunk (interim or final), or null if
   *  none has arrived yet (or captions are off/were just turned off).
   *  Current-line-only for the MVP -- no caption history. */
  caption: CaptionUpdatePayload | null;
  onClearHistory: () => void;
  onDisable: () => void;
  onPositionChange: (position: OverlayPosition) => void;
}

export function Overlay({
  state,
  gesture,
  personalizedGesture,
  history,
  caption,
  onClearHistory,
  onDisable,
  onPositionChange,
}: OverlayProps) {
  const [position, setPosition] = useState<OverlayPosition>(state.overlayPosition);
  const dragState = useRef<{ startX: number; startY: number; origin: OverlayPosition } | null>(
    null,
  );

  const handlePointerDown = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      dragState.current = {
        startX: event.clientX,
        startY: event.clientY,
        origin: position,
      };
      (event.target as HTMLElement).setPointerCapture(event.pointerId);
    },
    [position],
  );

  const handlePointerMove = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (!dragState.current) return;
    const { startX, startY, origin } = dragState.current;
    setPosition({
      x: Math.max(0, origin.x - (event.clientX - startX)),
      y: Math.max(0, origin.y + (event.clientY - startY)),
    });
  }, []);

  const handlePointerUp = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (!dragState.current) return;
      dragState.current = null;
      (event.target as HTMLElement).releasePointerCapture(event.pointerId);
      onPositionChange(position);
    },
    [position, onPositionChange],
  );

  const lang = state.language;

  // Four states: feature off; not enabled long enough for a first event yet;
  // a stable-but-unrecognized result (UNKNOWN -- e.g. no hand in frame); a
  // real recognized gesture, where the LOCALIZED mapped text (not the raw
  // label) is the primary, prominent line and the label+confidence become
  // secondary detail underneath it.
  let primaryText: string;
  let secondaryText: string | null = null;
  if (!state.gestureRecognition) {
    primaryText = t("overlay.gestureOff", lang);
  } else if (!gesture) {
    primaryText = t("overlay.waitingGesture", lang);
  } else if (gesture.gesture === "UNKNOWN") {
    primaryText = t("overlay.unknownGesture", lang);
  } else {
    primaryText = getLocalizedGestureText(gesture.gesture, lang) ?? gesture.gesture.replace(/_/g, " ");
    secondaryText = `${gesture.gesture.replace(/_/g, " ")} · ${Math.round(gesture.confidence * 100)}%`;
  }

  // Same three-state shape as the gesture display above, plus a fourth:
  // captions genuinely can't produce a real transcript right now (Part 8,
  // widened in Phase 11 Part C to cover "this browser has no
  // SpeechRecognition at all" and "microphone access denied", not just
  // "wrong language") -- always a clear, translated explanation, never a
  // raw SpeechRecognition error code or DOMException.
  let captionText: string;
  let captionIsInterim = false;
  if (!state.captions) {
    captionText = t("overlay.captionsOff", lang);
  } else if (caption?.unsupported) {
    captionText =
      caption.unsupportedReason === "browser"
        ? t("overlay.captionsUnavailable.browser", lang)
        : caption.unsupportedReason === "permission"
          ? t("overlay.captionsUnavailable.permission", lang)
          : t("overlay.captionsUnavailable", lang);
  } else if (!caption) {
    captionText = t("overlay.waitingSpeech", lang);
  } else {
    captionText = caption.text;
    captionIsInterim = !caption.isFinal;
  }

  const sizeClass = state.largeText ? "text-base" : "text-sm";
  const contrastClass = state.highContrast
    ? "border-black bg-white text-black [&_*]:text-black"
    : "border-slate-200 bg-white/95 text-slate-700";
  const motionClass = state.reducedMotion ? "" : "backdrop-blur transition-colors";

  return (
    <div
      className={`signsync-root fixed w-80 max-w-[calc(100vw_-_40px)] select-none rounded-xl border font-sans shadow-2xl ${sizeClass} ${contrastClass} ${motionClass}`}
      style={{ right: position.x, bottom: position.y, zIndex: 2147483647 }}
    >
      <div
        className="flex cursor-grab items-center justify-between rounded-t-xl bg-brand-600 px-3 py-2 text-white active:cursor-grabbing"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      >
        <div className="flex items-center gap-1.5 text-sm font-semibold tracking-wide">
          <GripHorizontal className="h-4 w-4 opacity-70" />
          SignSync
        </div>
        <div className="flex items-center gap-1.5 text-xs font-medium">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-300 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
          </span>
          ON
        </div>
      </div>

      <div className="space-y-2.5 px-3 py-3 text-sm text-slate-700">
        <div className="rounded-lg bg-slate-50 px-2.5 py-2">
          <div className="flex items-center gap-2 font-medium text-slate-900">
            <Hand className="h-4 w-4 text-brand-600" />
            {primaryText}
          </div>
          {secondaryText && (
            <div className="pl-6 text-xs font-semibold text-brand-700">{secondaryText}</div>
          )}
          {personalizedGesture && (
            // Personalized-gesture display: user-taught, not a verified
            // sign-language sign -- name + meaning + confidence only, never
            // gestureId/distance/threshold (those stay in [PERS] console
            // diagnostics, gated by SignSyncState.developerDiagnostics
            // elsewhere -- see the Validate page).
            <div className="pl-6 text-xs">
              <div className="font-semibold text-emerald-700">
                🤟 {personalizedGesture.name} · {Math.round(personalizedGesture.confidence * 100)}%
              </div>
              <div className="text-emerald-600">{personalizedGesture.meaning}</div>
            </div>
          )}
        </div>

        <div>
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              {t("overlay.conversation.heading", lang)}
            </span>
            {history.length > 0 && (
              <button
                type="button"
                onClick={onClearHistory}
                className="text-xs font-medium text-slate-400 hover:text-slate-600"
              >
                {t("overlay.clear", lang)}
              </button>
            )}
          </div>
          {history.length === 0 ? (
            <p className="truncate text-sm text-slate-600">{t("overlay.startSigning", lang)}</p>
          ) : (
            <ul className="max-h-28 space-y-1 overflow-y-auto pr-0.5">
              {[...history].reverse().map((entry, index) => (
                <li key={history.length - index} className="flex items-start gap-1.5 text-xs">
                  {entry.source === "gesture" ? (
                    <Hand className="mt-0.5 h-3 w-3 shrink-0 text-brand-500" />
                  ) : (
                    <Mic className="mt-0.5 h-3 w-3 shrink-0 text-slate-400" />
                  )}
                  <span className="min-w-0 flex-1 truncate text-slate-700">{entry.text}</span>
                  <span className="shrink-0 text-slate-400">{formatClockTime(entry.timestamp)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex items-center gap-2 text-slate-600">
          <Captions className="h-4 w-4 shrink-0 text-slate-400" />
          <span className={`truncate ${captionIsInterim ? "italic text-slate-400" : ""}`}>
            {captionText}
          </span>
        </div>

        <div className="flex items-center gap-2 text-slate-600">
          <Volume2 className="h-4 w-4 shrink-0 text-slate-400" />
          <span>{state.speechOutput ? t("overlay.speechReady", lang) : t("overlay.speechOff", lang)}</span>
        </div>
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-slate-100 px-3 py-2">
        <button
          type="button"
          title={t("overlay.settings", lang)}
          className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-slate-500 hover:bg-slate-100"
        >
          <Settings className="h-3.5 w-3.5" />
          {t("overlay.settings", lang)}
        </button>
        <button
          type="button"
          onClick={onDisable}
          className="flex items-center gap-1.5 rounded-md bg-red-50 px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-100"
        >
          <X className="h-3.5 w-3.5" />
          {t("overlay.disable", lang)}
        </button>
      </div>
    </div>
  );
}
