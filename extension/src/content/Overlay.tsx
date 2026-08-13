import { useCallback, useRef, useState } from "react";
import type { PointerEvent } from "react";
import { Hand, Volume2, Captions, Settings, X, GripHorizontal } from "lucide-react";
import type { GestureDetectedPayload, OverlayPosition, SignSyncState } from "@/types";

interface OverlayProps {
  state: SignSyncState;
  /** Latest stabilized gesture event, or null if none has arrived yet
   *  (or gesture recognition is off/was just turned off). */
  gesture: GestureDetectedPayload | null;
  /** Recent recognized-gesture text, oldest first, bounded to MAX_HISTORY
   *  (see OverlayRoot.tsx). UNKNOWN gestures are never included. */
  history: string[];
  onClearHistory: () => void;
  onDisable: () => void;
  onPositionChange: (position: OverlayPosition) => void;
}

export function Overlay({
  state,
  gesture,
  history,
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

  // Four states: feature off; not enabled long enough for a first event yet;
  // a stable-but-unrecognized result (UNKNOWN -- e.g. no hand in frame); a
  // real recognized gesture, where the mapped text (not the raw label) is
  // the primary, prominent line and the label+confidence become secondary
  // detail underneath it.
  let primaryText: string;
  let secondaryText: string | null = null;
  if (!state.gestureRecognition) {
    primaryText = "Gesture off";
  } else if (!gesture) {
    primaryText = "Waiting for gesture...";
  } else if (gesture.gesture === "UNKNOWN") {
    primaryText = "Gesture not recognized";
  } else {
    primaryText = gesture.text ?? gesture.gesture.replace(/_/g, " ");
    secondaryText = `${gesture.gesture.replace(/_/g, " ")} · ${Math.round(gesture.confidence * 100)}%`;
  }

  return (
    <div
      className="signsync-root fixed w-80 max-w-[calc(100vw_-_40px)] select-none rounded-xl border border-slate-200 bg-white/95 font-sans shadow-2xl backdrop-blur"
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
        </div>

        <div>
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              Recent
            </span>
            {history.length > 0 && (
              <button
                type="button"
                onClick={onClearHistory}
                className="text-xs font-medium text-slate-400 hover:text-slate-600"
              >
                Clear
              </button>
            )}
          </div>
          <p className="truncate text-sm text-slate-600">
            {history.length > 0 ? history.join(" · ") : "Start signing..."}
          </p>
        </div>

        <div className="flex items-center gap-2 text-slate-600">
          <Captions className="h-4 w-4 shrink-0 text-slate-400" />
          <span className="truncate">
            {state.captions ? "Waiting for speech..." : "Captions off"}
          </span>
        </div>

        <div className="flex items-center gap-2 text-slate-600">
          <Volume2 className="h-4 w-4 shrink-0 text-slate-400" />
          <span>{state.speechOutput ? "Speech output ready" : "Speech output off"}</span>
        </div>

        <div className="flex items-center justify-between pt-1 text-xs text-slate-400">
          <span>Status: Ready</span>
          <span>{state.language}</span>
        </div>
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-slate-100 px-3 py-2">
        <button
          type="button"
          title="Settings (coming soon)"
          className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-slate-500 hover:bg-slate-100"
        >
          <Settings className="h-3.5 w-3.5" />
          Settings
        </button>
        <button
          type="button"
          onClick={onDisable}
          className="flex items-center gap-1.5 rounded-md bg-red-50 px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-100"
        >
          <X className="h-3.5 w-3.5" />
          Disable
        </button>
      </div>
    </div>
  );
}
