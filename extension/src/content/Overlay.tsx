import { useCallback, useRef, useState } from "react";
import type { PointerEvent } from "react";
import { Hand, Volume2, Captions, Settings, X, GripHorizontal } from "lucide-react";
import type { OverlayPosition, SignSyncState } from "@/types";

interface OverlayProps {
  state: SignSyncState;
  onDisable: () => void;
  onPositionChange: (position: OverlayPosition) => void;
}

/**
 * Dummy data standing in for the future gesture-recognition pipeline
 * (see PRD.md §12-14 and TECH_SPEC.md §12-16). No AI runs here yet.
 */
const DUMMY_GESTURE = "HELP";
const DUMMY_CONFIDENCE = 0.94;

export function Overlay({ state, onDisable, onPositionChange }: OverlayProps) {
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

  return (
    <div
      className="signsync-root fixed w-72 select-none rounded-xl border border-slate-200 bg-white/95 font-sans shadow-2xl backdrop-blur"
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
        <div className="flex items-center justify-between rounded-lg bg-slate-50 px-2.5 py-2">
          <div className="flex items-center gap-2 font-medium text-slate-900">
            <Hand className="h-4 w-4 text-brand-600" />
            {state.gestureRecognition ? DUMMY_GESTURE : "Gesture off"}
          </div>
          {state.gestureRecognition && (
            <span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs font-semibold text-brand-700">
              {Math.round(DUMMY_CONFIDENCE * 100)}%
            </span>
          )}
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
