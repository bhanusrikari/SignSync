import { useState } from "react";
import type { ReactNode } from "react";
import { BookOpen, Captions, ChevronDown, Hand, Languages, Settings as SettingsIcon, Sparkles, Volume2 } from "lucide-react";
import { t } from "@/i18n";
import { LANGUAGES } from "@/shared/constants";
import type { LanguageCode, SignSyncState } from "@/types";

interface DashboardProps {
  state: SignSyncState;
  onToggleEnabled: (enabled: boolean) => void;
  onUpdateSettings: (partial: Partial<Omit<SignSyncState, "enabled">>) => void;
  onOpenSettings: () => void;
  onOpenTutorials: () => void;
  onOpenRecord: () => void;
  onOpenValidate: () => void;
}

/** One capability row on the dashboard -- an icon, a title + short plain-
 *  language description (Phase 10 Part 3's "what can SignSync do for me?"
 *  wording), and either a toggle or a navigation action on the right. Never
 *  mentions IndexedDB/offscreen/MediaPipe/classifier/stabilizer/inference --
 *  those are developer concepts (Phase 10's core product principle). */
function CapabilityRow({
  icon,
  title,
  description,
  right,
  disabled,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  right: ReactNode;
  disabled?: boolean;
}) {
  return (
    <div className={`flex items-start gap-3 rounded-lg px-2.5 py-2.5 ${disabled ? "opacity-50" : "hover:bg-slate-50"}`}>
      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-slate-800">{title}</p>
        <p className="text-xs leading-snug text-slate-500">{description}</p>
      </div>
      <div className="shrink-0 pt-1">{right}</div>
    </div>
  );
}

function Toggle({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors disabled:cursor-not-allowed ${
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

export function Dashboard({
  state,
  onToggleEnabled,
  onUpdateSettings,
  onOpenSettings,
  onOpenTutorials,
  onOpenRecord,
  onOpenValidate,
}: DashboardProps) {
  const [languageOpen, setLanguageOpen] = useState(false);
  const lang = state.language;

  return (
    <div className="space-y-1 px-3 py-3">
      <div className="mb-1 flex items-center justify-between rounded-lg bg-slate-50 px-2.5 py-2.5">
        <div>
          <p className="text-sm font-semibold text-slate-800">
            {state.enabled ? t("dashboard.cta.on", lang) : t("dashboard.cta.enable", lang)}
          </p>
          <p className="text-xs text-slate-500">
            {state.enabled ? t("dashboard.disableHint", lang) : t("dashboard.enableHint", lang)}
          </p>
        </div>
        <Toggle checked={state.enabled} onChange={onToggleEnabled} />
      </div>

      <CapabilityRow
        icon={<Captions className="h-4 w-4" />}
        title={t("dashboard.captions.title", lang)}
        description={t("dashboard.captions.description", lang)}
        disabled={!state.enabled}
        right={<Toggle checked={state.captions} onChange={(v) => onUpdateSettings({ captions: v })} disabled={!state.enabled} />}
      />

      <CapabilityRow
        icon={<Hand className="h-4 w-4" />}
        title={t("dashboard.signToText.title", lang)}
        description={t("dashboard.signToText.description", lang)}
        disabled={!state.enabled}
        right={
          <Toggle
            checked={state.gestureRecognition}
            onChange={(v) => onUpdateSettings({ gestureRecognition: v })}
            disabled={!state.enabled}
          />
        }
      />

      <CapabilityRow
        icon={<Volume2 className="h-4 w-4" />}
        title={t("dashboard.signToSpeech.title", lang)}
        description={t("dashboard.signToSpeech.description", lang)}
        disabled={!state.enabled}
        right={
          <Toggle checked={state.speechOutput} onChange={(v) => onUpdateSettings({ speechOutput: v })} disabled={!state.enabled} />
        }
      />

      <button type="button" onClick={() => setLanguageOpen((v) => !v)} className="block w-full text-left">
        <CapabilityRow
          icon={<Languages className="h-4 w-4" />}
          title={t("dashboard.languages.title", lang)}
          description={t("dashboard.languages.description", lang)}
          right={<ChevronDown className={`h-4 w-4 text-slate-400 transition-transform ${languageOpen ? "rotate-180" : ""}`} />}
        />
      </button>
      {languageOpen && (
        <div className="px-2.5 pb-1">
          <select
            value={lang}
            onChange={(event) => onUpdateSettings({ language: event.target.value as LanguageCode })}
            className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm text-slate-800 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          >
            {Object.values(LANGUAGES).map((l) => (
              <option key={l.code} value={l.code}>
                {t(`language.${l.code.slice(0, 2)}`, lang)}
              </option>
            ))}
          </select>
        </div>
      )}

      <button type="button" onClick={onOpenTutorials} className="block w-full text-left">
        <CapabilityRow
          icon={<BookOpen className="h-4 w-4" />}
          title={t("dashboard.learn.title", lang)}
          description={t("dashboard.learn.description", lang)}
          right={<span className="text-xs text-slate-400">›</span>}
        />
      </button>

      <div>
        <CapabilityRow
          icon={<Sparkles className="h-4 w-4" />}
          title={t("dashboard.myGestures.title", lang)}
          description={t("dashboard.myGestures.description", lang)}
          right={
            <div className="flex gap-1.5">
              <button
                type="button"
                onClick={onOpenRecord}
                aria-label={t("dashboard.myGestures.record", lang)}
                className="rounded-md border border-dashed border-slate-200 px-2 py-1 text-[11px] font-medium text-slate-500 hover:border-brand-300 hover:text-brand-600"
              >
                +
              </button>
              <button
                type="button"
                onClick={onOpenValidate}
                aria-label={t("dashboard.myGestures.validate", lang)}
                className="rounded-md border border-dashed border-slate-200 px-2 py-1 text-[11px] font-medium text-slate-500 hover:border-brand-300 hover:text-brand-600"
              >
                ✓
              </button>
            </div>
          }
        />
      </div>

      <button type="button" onClick={onOpenSettings} className="block w-full text-left">
        <CapabilityRow
          icon={<SettingsIcon className="h-4 w-4" />}
          title={t("dashboard.settings.title", lang)}
          description={t("dashboard.settings.description", lang)}
          right={<span className="text-xs text-slate-400">›</span>}
        />
      </button>
    </div>
  );
}
