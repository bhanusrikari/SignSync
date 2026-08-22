import { useEffect, useState } from "react";
import { getPersonalizedGestures } from "@/services/personalizedGestures";
import { getLocalizedMeaning } from "@/shared/personalizedGestures";
import { TUTORIAL_CATEGORIES, TUTORIAL_REGIONS, getSignsForCategory, type TutorialRegion } from "@/shared/tutorialContent";
import { t } from "@/i18n";
import { sendToBackground } from "@/utils/messaging";
import { DEFAULT_STATE } from "@/shared/constants";
import { pageAccessibilityClasses } from "@/shared/accessibilityClasses";
import type { LanguageCode, PersonalizedGesture, SignSyncState } from "@/types";

/**
 * Learn Sign Language hub (Phase 10 Part 6) -- region picker (ASL/ISL),
 * category grid, and per-category tutorial cards. Honestly shows a "coming
 * soon" empty state everywhere (see shared/tutorialContent.ts's header for
 * why) rather than inventing sign-language content SignSync cannot verify.
 *
 * Also lists the user's OWN personalized gestures in a clearly separate
 * section, explicitly labeled as user-taught custom gestures rather than
 * verified sign-language signs (Part 6's explicit distinction requirement).
 */
export function App() {
  const [region, setRegion] = useState<TutorialRegion>("ISL");
  const [language, setLanguage] = useState<LanguageCode>(DEFAULT_STATE.language);
  const [personalizedGestures, setPersonalizedGestures] = useState<PersonalizedGesture[]>([]);
  const [a11y, setA11y] = useState({ highContrast: false, largeText: false, reducedMotion: false });

  useEffect(() => {
    sendToBackground<SignSyncState>({ type: "GET_STATE" }).then((state) => {
      setLanguage(state.language);
      setA11y({ highContrast: state.highContrast, largeText: state.largeText, reducedMotion: state.reducedMotion });
    });
    void getPersonalizedGestures().then(setPersonalizedGestures);
  }, []);

  return (
    <div className={`min-h-screen bg-slate-50 p-6 font-sans ${pageAccessibilityClasses(a11y)}`}>
      <div className="mx-auto max-w-3xl space-y-6">
        <header>
          <h1 className="text-xl font-bold text-slate-900">📚 {t("tutorials.title", language)}</h1>
        </header>

        <section>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
            {t("tutorials.chooseRegion", language)}
          </h2>
          <div className="flex gap-2">
            {TUTORIAL_REGIONS.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => setRegion(r.id)}
                className={`rounded-lg border px-3 py-1.5 text-sm font-medium ${
                  region === r.id
                    ? "border-brand-500 bg-brand-50 text-brand-700"
                    : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
                }`}
              >
                {r.flag} {t(r.nameKey, language)}
              </button>
            ))}
          </div>
        </section>

        <section>
          <div className="mb-3 rounded-lg bg-brand-50 p-3">
            <h2 className="text-sm font-semibold text-brand-800">✓ {t("tutorials.verifiedHeading", language)}</h2>
            <p className="text-xs text-brand-700">{t("tutorials.verifiedExplanation", language)}</p>
          </div>
        </section>

        <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5">
          {TUTORIAL_CATEGORIES.map((category) => {
            const signs = getSignsForCategory(region, category.id);
            return (
              <div key={category.id} className="rounded-lg border border-slate-200 bg-white p-3">
                <p className="text-sm font-semibold text-slate-800">
                  {category.emoji} {t(category.labelKey, language)}
                </p>
                {signs.length === 0 ? (
                  <p className="mt-1.5 text-xs text-slate-400">{t("tutorials.comingSoon", language)}</p>
                ) : (
                  <ul className="mt-1.5 space-y-1">
                    {signs.map((sign) => (
                      <li key={sign.id} className="text-xs text-slate-600">
                        {sign.name} — {sign.meaning}
                        {sign.source && <span className="text-slate-400"> ({sign.source})</span>}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </section>

        <section>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
            {t("dashboard.myGestures.title", language)}
          </h2>
          {personalizedGestures.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-300 bg-white p-4 text-center text-sm text-slate-500">
              {t("validate.empty.title", language)}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {personalizedGestures.map((gesture) => (
                <div key={gesture.id} className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
                  <p className="text-sm font-semibold uppercase text-emerald-900">🤟 {gesture.name}</p>
                  <p className="text-xs text-emerald-800">{getLocalizedMeaning(gesture, language)}</p>
                  <p className="mt-1.5 text-[11px] italic text-emerald-700">{t("tutorials.customGestureNote", language)}</p>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
