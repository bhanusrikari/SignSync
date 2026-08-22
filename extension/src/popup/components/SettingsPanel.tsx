import { ChevronLeft, Contrast, Type, Zap } from "lucide-react";
import { t } from "@/i18n";
import { LANGUAGES } from "@/shared/constants";
import type { ReactNode } from "react";
import type { LanguageCode, SignSyncState } from "@/types";

interface SettingsPanelProps {
  state: SignSyncState;
  onUpdateSettings: (partial: Partial<Omit<SignSyncState, "enabled">>) => void;
  onBack: () => void;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-1 rounded-lg border border-slate-100 p-2">
      <p className="px-1 pb-0.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">{title}</p>
      {children}
    </section>
  );
}

function Row({
  label,
  hint,
  control,
}: {
  label: string;
  hint?: string;
  control: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 px-1 py-1.5">
      <div className="min-w-0">
        <p className="text-sm text-slate-800">{label}</p>
        {hint && <p className="text-[11px] leading-snug text-slate-400">{hint}</p>}
      </div>
      <div className="shrink-0">{control}</div>
    </div>
  );
}

function MiniToggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
        checked ? "bg-brand-600" : "bg-slate-300"
      }`}
    >
      <span
        className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
          checked ? "translate-x-[18px]" : "translate-x-1"
        }`}
      />
    </button>
  );
}

function LanguagePicker({ value, onChange }: { value: LanguageCode; onChange: (v: LanguageCode) => void }) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value as LanguageCode)}
      className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-800 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
    >
      {Object.values(LANGUAGES).map((l) => (
        <option key={l.code} value={l.code}>
          {t(`language.${l.code.slice(0, 2)}`, value)}
        </option>
      ))}
    </select>
  );
}

/**
 * Sectioned settings view (Phase 10 Part 11): Captions / Gestures / Speech /
 * Language / Camera / Accessibility / Advanced. Shown inside the popup as a
 * second "screen" (see popup/App.tsx) rather than a separate extension
 * page, since chrome.storage-backed SignSyncState is already available
 * wherever the popup is, and this keeps the whole settings surface in one
 * place a user already knows how to open (the toolbar icon).
 */
export function SettingsPanel({ state, onUpdateSettings, onBack }: SettingsPanelProps) {
  const lang = state.language;

  return (
    <div className="space-y-2.5 px-3 py-3">
      <button
        type="button"
        onClick={onBack}
        className="mb-1 flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-700"
      >
        <ChevronLeft className="h-3.5 w-3.5" />
        {t("dashboard.back", lang)}
      </button>

      <Section title={t("settings.captions.heading", lang)}>
        <Row
          label={t("settings.captions.enable", lang)}
          hint={t("settings.captions.enableHint", lang)}
          control={<MiniToggle checked={state.captions} onChange={(v) => onUpdateSettings({ captions: v })} />}
        />
        <Row
          label={t("settings.captions.language", lang)}
          control={<LanguagePicker value={state.language} onChange={(language) => onUpdateSettings({ language })} />}
        />
      </Section>

      <Section title={t("settings.gestures.heading", lang)}>
        <Row
          label={t("settings.gestures.enable", lang)}
          hint={t("settings.gestures.enableHint", lang)}
          control={<MiniToggle checked={state.gestureRecognition} onChange={(v) => onUpdateSettings({ gestureRecognition: v })} />}
        />
      </Section>

      <Section title={t("settings.speech.heading", lang)}>
        <Row
          label={t("settings.speech.enable", lang)}
          hint={t("settings.speech.enableHint", lang)}
          control={<MiniToggle checked={state.speechOutput} onChange={(v) => onUpdateSettings({ speechOutput: v })} />}
        />
        <Row
          label={t("settings.speech.language", lang)}
          control={<LanguagePicker value={state.language} onChange={(language) => onUpdateSettings({ language })} />}
        />
      </Section>

      <Section title={t("settings.language.heading", lang)}>
        <Row
          label={t("settings.language.interface", lang)}
          control={<LanguagePicker value={state.language} onChange={(language) => onUpdateSettings({ language })} />}
        />
      </Section>

      <Section title={t("settings.accessibility.heading", lang)}>
        <Row
          label={t("settings.accessibility.highContrast", lang)}
          hint={t("settings.accessibility.highContrastHint", lang)}
          control={
            <span className="flex items-center gap-1.5">
              <Contrast className="h-3.5 w-3.5 text-slate-400" />
              <MiniToggle checked={state.highContrast} onChange={(v) => onUpdateSettings({ highContrast: v })} />
            </span>
          }
        />
        <Row
          label={t("settings.accessibility.largeText", lang)}
          hint={t("settings.accessibility.largeTextHint", lang)}
          control={
            <span className="flex items-center gap-1.5">
              <Type className="h-3.5 w-3.5 text-slate-400" />
              <MiniToggle checked={state.largeText} onChange={(v) => onUpdateSettings({ largeText: v })} />
            </span>
          }
        />
        <Row
          label={t("settings.accessibility.reducedMotion", lang)}
          hint={t("settings.accessibility.reducedMotionHint", lang)}
          control={
            <span className="flex items-center gap-1.5">
              <Zap className="h-3.5 w-3.5 text-slate-400" />
              <MiniToggle checked={state.reducedMotion} onChange={(v) => onUpdateSettings({ reducedMotion: v })} />
            </span>
          }
        />
      </Section>

      <Section title={t("settings.advanced.heading", lang)}>
        <Row
          label={t("settings.advanced.diagnostics", lang)}
          hint={t("settings.advanced.diagnosticsHint", lang)}
          control={<MiniToggle checked={state.developerDiagnostics} onChange={(v) => onUpdateSettings({ developerDiagnostics: v })} />}
        />
      </Section>
    </div>
  );
}
