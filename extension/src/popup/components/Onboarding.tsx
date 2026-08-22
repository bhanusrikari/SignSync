import { BookOpen, Captions, Hand, Languages, Volume2 } from "lucide-react";
import { t } from "@/i18n";
import type { LanguageCode } from "@/types";

interface OnboardingProps {
  language: LanguageCode;
  onGetStarted: () => void;
  onSkip: () => void;
}

/**
 * Lightweight first-run welcome screen (Phase 10 Part 14) -- shown once,
 * inside the popup itself (no separate page/tab), gated by
 * SignSyncState.hasSeenOnboarding. Deliberately just one screen with one
 * button: PRD §8.1's own mockup is exactly "SignSync / AI Accessibility
 * Companion / [Get Started]" -- this doesn't force a multi-step setup
 * wizard, just states what SignSync does and gets out of the way.
 */
export function Onboarding({ language, onGetStarted, onSkip }: OnboardingProps) {
  return (
    <div className="space-y-4 px-4 py-5 text-center">
      <div>
        <p className="text-lg font-bold text-slate-900">{t("onboarding.welcome", language)}</p>
        <p className="mt-1 text-sm text-slate-500">{t("onboarding.intro", language)}</p>
      </div>

      <ul className="space-y-2 text-left text-sm text-slate-700">
        <li className="flex items-center gap-2.5 rounded-lg bg-slate-50 px-3 py-2">
          <Hand className="h-4 w-4 shrink-0 text-brand-600" />
          {t("onboarding.feature.signs", language)}
        </li>
        <li className="flex items-center gap-2.5 rounded-lg bg-slate-50 px-3 py-2">
          <Captions className="h-4 w-4 shrink-0 text-brand-600" />
          {t("onboarding.feature.captions", language)}
        </li>
        <li className="flex items-center gap-2.5 rounded-lg bg-slate-50 px-3 py-2">
          <Volume2 className="h-4 w-4 shrink-0 text-brand-600" />
          {t("onboarding.feature.speech", language)}
        </li>
        <li className="flex items-center gap-2.5 rounded-lg bg-slate-50 px-3 py-2">
          <Languages className="h-4 w-4 shrink-0 text-brand-600" />
          {t("onboarding.feature.languages", language)}
        </li>
        <li className="flex items-center gap-2.5 rounded-lg bg-slate-50 px-3 py-2">
          <BookOpen className="h-4 w-4 shrink-0 text-brand-600" />
          {t("onboarding.feature.learn", language)}
        </li>
      </ul>

      <div className="space-y-1.5 pt-1">
        <button
          type="button"
          onClick={onGetStarted}
          className="w-full rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700"
        >
          {t("onboarding.getStarted", language)}
        </button>
        <button type="button" onClick={onSkip} className="w-full text-xs font-medium text-slate-400 hover:text-slate-600">
          {t("onboarding.skip", language)}
        </button>
      </div>
    </div>
  );
}
