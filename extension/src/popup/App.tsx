import { useEffect, useState } from "react";
import { Header } from "./components/Header";
import { Footer } from "./components/Footer";
import { Onboarding } from "./components/Onboarding";
import { Dashboard } from "./components/Dashboard";
import { SettingsPanel } from "./components/SettingsPanel";
import { DEFAULT_STATE } from "@/shared/constants";
import { sendToBackground } from "@/utils/messaging";
import { t } from "@/i18n";
import type { SignSyncState } from "@/types";

type View = "onboarding" | "dashboard" | "settings";

export function App() {
  const [state, setState] = useState<SignSyncState>(DEFAULT_STATE);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<string | null>(null);
  const [view, setView] = useState<View>("dashboard");

  useEffect(() => {
    sendToBackground<SignSyncState>({ type: "GET_STATE" }).then((result) => {
      setState(result);
      setView(result.hasSeenOnboarding ? "dashboard" : "onboarding");
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

  const finishOnboarding = () => {
    updateSettings({ hasSeenOnboarding: true });
    setView("dashboard");
  };

  const openTab = (page: string) => chrome.tabs.create({ url: chrome.runtime.getURL(page) });

  if (loading) {
    return (
      <div className="flex h-40 w-80 items-center justify-center text-sm text-slate-400">
        {t("app.name", "en-IN")}…
      </div>
    );
  }

  const sizeClass = state.largeText ? "text-base" : "text-sm";
  const contrastClass = state.highContrast ? "bg-white text-black" : "bg-white text-slate-800";

  return (
    <div className={`relative w-80 font-sans ${sizeClass} ${contrastClass}`}>
      <Header enabled={state.enabled} language={state.language} />

      {view === "onboarding" && (
        <Onboarding language={state.language} onGetStarted={finishOnboarding} onSkip={finishOnboarding} />
      )}

      {view === "dashboard" && (
        <Dashboard
          state={state}
          onToggleEnabled={setEnabled}
          onUpdateSettings={updateSettings}
          onOpenSettings={() => setView("settings")}
          onOpenTutorials={() => openTab("tutorials.html")}
          onOpenRecord={() => openTab("record.html")}
          onOpenValidate={() => openTab("validate.html")}
        />
      )}

      {view === "settings" && (
        <SettingsPanel state={state} onUpdateSettings={updateSettings} onBack={() => setView("dashboard")} />
      )}

      {view !== "onboarding" && (
        <Footer
          onSettings={() => setView("settings")}
          onAbout={() => setToast("SignSync v0.1.0")}
        />
      )}

      {toast && (
        <div className="absolute inset-x-3 bottom-2 rounded-md bg-slate-900 px-3 py-1.5 text-center text-xs text-white shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}
