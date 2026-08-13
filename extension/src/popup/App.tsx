import { useEffect, useState } from "react";
import { Hand, Captions, Volume2 } from "lucide-react";
import { Header } from "./components/Header";
import { Footer } from "./components/Footer";
import { ToggleSwitch } from "./components/ToggleSwitch";
import { LanguageSelector } from "./components/LanguageSelector";
import { DEFAULT_STATE } from "@/shared/constants";
import { sendToBackground } from "@/utils/messaging";
import type { LanguageCode, SignSyncState } from "@/types";

export function App() {
  const [state, setState] = useState<SignSyncState>(DEFAULT_STATE);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    sendToBackground<SignSyncState>({ type: "GET_STATE" }).then((result) => {
      setState(result);
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 2000);
    return () => clearTimeout(timer);
  }, [toast]);

  const setEnabled = (enabled: boolean) => {
    setState((prev) => ({ ...prev, enabled }));
    sendToBackground<SignSyncState>({ type: "SET_ENABLED", payload: { enabled } }).then(setState);
  };

  const updateSettings = (partial: Partial<Omit<SignSyncState, "enabled">>) => {
    setState((prev) => ({ ...prev, ...partial }));
    sendToBackground<SignSyncState>({ type: "UPDATE_SETTINGS", payload: partial }).then(setState);
  };

  if (loading) {
    return (
      <div className="flex h-40 w-80 items-center justify-center text-sm text-slate-400">
        Loading SignSync…
      </div>
    );
  }

  return (
    <div className="relative w-80 bg-white font-sans">
      <Header enabled={state.enabled} />

      <div className="space-y-4 px-4 py-3.5">
        <ToggleSwitch
          id="enabled"
          checked={state.enabled}
          onChange={setEnabled}
          label="Accessibility"
          description={state.enabled ? "SignSync is active on this tab" : "Turn on to show the overlay"}
        />

        <div className="space-y-1 rounded-lg border border-slate-100 p-1">
          <p className="px-1.5 pt-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
            Features
          </p>
          <ToggleSwitch
            id="gestureRecognition"
            checked={state.gestureRecognition}
            onChange={(checked) => updateSettings({ gestureRecognition: checked })}
            disabled={!state.enabled}
            label="Gesture Recognition"
            icon={<Hand className="h-4 w-4" />}
          />
          <ToggleSwitch
            id="captions"
            checked={state.captions}
            onChange={(checked) => updateSettings({ captions: checked })}
            disabled={!state.enabled}
            label="Live Captions"
            icon={<Captions className="h-4 w-4" />}
          />
          <ToggleSwitch
            id="speechOutput"
            checked={state.speechOutput}
            onChange={(checked) => updateSettings({ speechOutput: checked })}
            disabled={!state.enabled}
            label="Speech Output"
            icon={<Volume2 className="h-4 w-4" />}
          />
        </div>

        <LanguageSelector
          value={state.language}
          onChange={(language: LanguageCode) => updateSettings({ language })}
        />
      </div>

      <Footer
        onSettings={() => setToast("Settings coming soon")}
        onAbout={() => setToast("SignSync v0.1.0 — Foundation build")}
      />

      {toast && (
        <div className="absolute inset-x-3 bottom-2 rounded-md bg-slate-900 px-3 py-1.5 text-center text-xs text-white shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}
