import { useCallback, useEffect, useRef, useState } from "react";
import { classifyCameraError, describeError } from "@/shared/camera";
import type { CameraResultStatus } from "@/shared/camera";
import { detectHands, disposeHandTracker, loadHandTracker } from "@/ai/handTracker";
import { extractHandFeatures } from "@/ai/gestureFeatures";
import { getPersonalizedGesture, savePersonalizedGesture, updatePersonalizedGesture } from "@/services/personalizedGestures";
import { t } from "@/i18n";
import { LANGUAGES } from "@/shared/constants";
import { pageAccessibilityClasses } from "@/shared/accessibilityClasses";
import { sendToBackground } from "@/utils/messaging";
import type { LanguageCode, PersonalizedGestureExample, SignSyncState } from "@/types";
import type { Point3D } from "@/ai/gestureTypes";
import {
  checkCaptureReadiness,
  cleanLocalizedMeanings,
  hasEnoughExamples,
  isNearDuplicateOfLast,
  MIN_EXAMPLES,
  RECOMMENDED_MAX_EXAMPLES,
  validateGestureName,
  validateGestureMeaning,
} from "./recordingValidation";
import type { CaptureReadiness } from "./recordingValidation";

/** Matches the offscreen document's detection cadence (see offscreen.ts's
 *  DETECTION_INTERVAL_MS) -- not shared code (offscreen.ts is a script
 *  entry point, not an importable module), just the same, independently
 *  reasonable choice for this page's own, unrelated detection loop. */
const DETECTION_INTERVAL_MS = 120;

type CameraPhase = "requesting" | "granted" | "error";
type Step = 1 | 2 | 3 | 4;

/** Languages a translation can be entered for -- every configured language
 *  (see shared/constants.ts's LANGUAGES) except English, which is the
 *  always-present default `meaning` field, never part of
 *  `localizedMeanings` itself (see types/index.ts's PersonalizedGesture). */
const TRANSLATABLE_LANGUAGES = Object.values(LANGUAGES).filter((l) => l.code !== "en-IN");

function cameraErrorMessage(
  status: CameraResultStatus,
  language: LanguageCode,
  errorName?: string,
  errorMessage?: string,
): string {
  switch (status) {
    case "denied":
      return t("record.error.cameraDenied", language);
    case "dismissed":
      return t("record.error.cameraDismissed", language);
    case "no_camera":
      return t("record.error.noCamera", language);
    case "unavailable":
      return t("record.error.cameraUnavailable", language);
    default:
      return `${t("record.error.cameraGeneric", language)}: ${errorName ?? "Unknown error"} - ${errorMessage ?? ""}`;
  }
}

/** Friendly (translated), non-technical status text for the camera/hand
 *  state -- never mentions MediaPipe, landmarks, or model internals. */
function friendlyStatus(
  cameraPhase: CameraPhase,
  cameraMessage: string,
  modelReady: boolean,
  readiness: CaptureReadiness,
  language: LanguageCode,
): string {
  if (cameraPhase === "requesting") return t("record.step2.cameraReady", language) + "…";
  if (cameraPhase === "error") return cameraMessage;
  if (!modelReady) return t("record.step2.cameraReady", language) + "…";
  if (readiness.ready) return t("record.step2.handDetected", language);
  switch (readiness.reason) {
    case "no_hand":
      return t("record.step2.lookingForHand", language);
    case "multiple_hands":
      return t("record.step2.multipleHands", language);
    case "wrong_landmark_count":
    case "non_finite_landmarks":
      return t("record.step2.trackingLost", language);
  }
}

function waitForVideoReady(video: HTMLVideoElement): Promise<void> {
  if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) return Promise.resolve();
  return new Promise((resolve) => {
    video.addEventListener("loadeddata", () => resolve(), { once: true });
  });
}

async function closeThisTab(): Promise<void> {
  const tab = await chrome.tabs.getCurrent();
  if (tab?.id !== undefined) await chrome.tabs.remove(tab.id);
}

/** Present only when this page was opened as "add more examples to gesture
 *  X" (see validate/App.tsx's "+ Add examples" button) rather than "create
 *  a new gesture" -- the default, unmodified flow when absent. Smallest
 *  possible change to close the "every recording session creates a
 *  separate gesture record" gap (see the Phase 8 report) without adding
 *  any new page, route, or redesign. */
function getAppendGestureId(): string | null {
  return new URLSearchParams(window.location.search).get("gestureId");
}

/** Step indicator dots -- purely visual, no navigation logic of its own.
 *  `aria-label` (Phase 12 Part J) announces progress to screen readers,
 *  since the dots themselves carry no text a screen reader could read. */
function StepIndicator({ current, total, label }: { current: number; total: number; label: string }) {
  return (
    <div className="flex items-center gap-1.5" role="img" aria-label={label}>
      {Array.from({ length: total }, (_, i) => i + 1).map((step) => (
        <span
          key={step}
          className={`h-1.5 flex-1 rounded-full ${step <= current ? "bg-brand-600" : "bg-slate-200"}`}
        />
      ))}
    </div>
  );
}

/** Dashed guide box overlaid on the camera preview (Phase 12 Part C) --
 *  purely a CSS overlay on top of the existing <video> element, zero effect
 *  on capture logic/landmarks/MediaPipe -- gives the "keep your hand inside
 *  the guide" instruction something concrete to point at. */
function CameraGuideOverlay() {
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
      <div className="h-[70%] w-[55%] rounded-2xl border-2 border-dashed border-white/70" />
    </div>
  );
}

export function App() {
  const appendGestureId = useRef(getAppendGestureId()).current;
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectionTimerRef = useRef<number | undefined>(undefined);
  /** Latest detection tick, read synchronously by handleCapture -- kept in a
   *  ref (not state) so the ~8/sec detection loop doesn't force a capture
   *  handler to close over a stale value. */
  const latestDetectionRef = useRef<{ handsDetected: number; landmarks?: Point3D[] }>({ handsDetected: 0 });

  const [language, setLanguage] = useState<LanguageCode>("en-IN");
  // Read by the camera-start effect below (Phase 11 Part F) so its error
  // messages localize -- a REF, not `language` itself, so the effect's
  // deps stay `[stopCameraAndModel]` and a language change mid-recording
  // never restarts the camera (that would be a real, forbidden behavior
  // change to camera lifecycle, not just to displayed text).
  const languageRef = useRef(language);
  useEffect(() => {
    languageRef.current = language;
  }, [language]);
  const [a11y, setA11y] = useState({ highContrast: false, largeText: false, reducedMotion: false });
  const [step, setStep] = useState<Step>(appendGestureId ? 3 : 1);

  const [name, setName] = useState("");
  const [meaning, setMeaning] = useState("");
  const [localizedMeanings, setLocalizedMeanings] = useState<Partial<Record<LanguageCode, string>>>({});
  const [nameError, setNameError] = useState<string | null>(null);
  const [meaningError, setMeaningError] = useState<string | null>(null);

  const [cameraPhase, setCameraPhase] = useState<CameraPhase>("requesting");
  const [cameraMessage, setCameraMessage] = useState("");
  const [modelReady, setModelReady] = useState(false);
  const [readiness, setReadiness] = useState<CaptureReadiness>({ ready: false, reason: "no_hand" });

  const [examples, setExamples] = useState<PersonalizedGestureExample[]>([]);
  const [captureMessage, setCaptureMessage] = useState<string | null>(null);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  /** Only used in "add examples to an existing gesture" mode
   *  (appendGestureId set). `examples` above stays exactly what it always
   *  was -- newly captured examples THIS session -- so the capture/quality
   *  logic below needs zero changes; on Save these are concatenated with
   *  the already-stored ones read here. */
  const [existingExamples, setExistingExamples] = useState<PersonalizedGestureExample[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    sendToBackground<SignSyncState>({ type: "GET_STATE" }).then((state) => {
      setLanguage(state.language);
      setA11y({ highContrast: state.highContrast, largeText: state.largeText, reducedMotion: state.reducedMotion });
    });
  }, []);

  useEffect(() => {
    if (!appendGestureId) return;
    getPersonalizedGesture(appendGestureId)
      .then((gesture) => {
        if (!gesture) {
          setLoadError(t("record.error.gestureNotFound", languageRef.current));
          return;
        }
        setName(gesture.name);
        setMeaning(gesture.meaning);
        setLocalizedMeanings(gesture.localizedMeanings ?? {});
        setExistingExamples(gesture.examples);
      })
      .catch((error) => {
        setLoadError(error instanceof Error ? error.message : String(error));
      });
  }, [appendGestureId]);

  const stopCameraAndModel = useCallback(() => {
    if (detectionTimerRef.current !== undefined) {
      clearInterval(detectionTimerRef.current);
      detectionTimerRef.current = undefined;
    }
    disposeHandTracker();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function start() {
      const mediaDevicesExists = !!navigator.mediaDevices;
      if (!mediaDevicesExists) {
        setCameraPhase("error");
        setCameraMessage(t("record.error.cameraUnavailableContext", languageRef.current));
        return;
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
        setCameraPhase("granted");
      } catch (error) {
        const { errorName, errorMessage } = describeError(error);
        const status = classifyCameraError(errorName, errorMessage);
        setCameraPhase("error");
        setCameraMessage(cameraErrorMessage(status, languageRef.current, errorName, errorMessage));
        return;
      }

      try {
        await loadHandTracker();
      } catch (error) {
        const { errorMessage } = describeError(error);
        setCameraPhase("error");
        setCameraMessage(`${t("record.error.modelLoadFailed", languageRef.current)}: ${errorMessage}`);
        return;
      }
      if (cancelled || !videoRef.current) return;

      await waitForVideoReady(videoRef.current);
      if (cancelled) return;
      setModelReady(true);

      detectionTimerRef.current = window.setInterval(() => {
        if (!videoRef.current) return;
        try {
          const result = detectHands(videoRef.current, performance.now());
          const landmarks = result.handsDetected > 0 ? result.landmarks[0] : undefined;
          latestDetectionRef.current = { handsDetected: result.handsDetected, landmarks };
          setReadiness(checkCaptureReadiness(result.handsDetected, landmarks));
        } catch (error) {
          console.error("[SignSync Record] detection tick failed:", error);
        }
      }, DETECTION_INTERVAL_MS);
    }

    void start();

    // Safety net for the user closing the tab directly (X button) rather
    // than via Cancel/Save -- the camera/model must never be left running.
    window.addEventListener("pagehide", stopCameraAndModel);

    return () => {
      cancelled = true;
      window.removeEventListener("pagehide", stopCameraAndModel);
      stopCameraAndModel();
    };
  }, [stopCameraAndModel]);

  function handleCapture() {
    const { handsDetected, landmarks } = latestDetectionRef.current;
    const currentReadiness = checkCaptureReadiness(handsDetected, landmarks);
    if (!currentReadiness.ready || !landmarks) {
      setCaptureMessage(friendlyStatus(cameraPhase, cameraMessage, modelReady, currentReadiness, language));
      return;
    }

    let normalizedLandmarks: Point3D[];
    try {
      normalizedLandmarks = extractHandFeatures(landmarks).normalizedLandmarks;
    } catch {
      setCaptureMessage(t("record.error.handPoseUnreadable", language));
      return;
    }

    if (isNearDuplicateOfLast(normalizedLandmarks, examples)) {
      setCaptureMessage(t("record.error.nearDuplicate", language));
      return;
    }

    const nextCount = examples.length + 1;
    setExamples((prev) => [...prev, { normalizedLandmarks, capturedAt: Date.now() }]);
    setCaptureMessage(`${t("record.step3.examplesCaptured", language)}: ${nextCount}`);
  }

  function handleRemoveExample(index: number) {
    setExamples((prev) => prev.filter((_, i) => i !== index));
    setCaptureMessage(null);
  }

  function handleResetAll() {
    setExamples([]);
    setCaptureMessage(null);
  }

  function handleCancel() {
    stopCameraAndModel();
    void closeThisTab();
  }

  function goToStep2() {
    const nameValidation = validateGestureName(name, language);
    const meaningValidation = validateGestureMeaning(meaning, language);
    setNameError(nameValidation);
    setMeaningError(meaningValidation);
    if (nameValidation || meaningValidation) return;
    setStep(2);
  }

  async function handleSave() {
    if (!hasEnoughExamples(examples.length)) {
      setCaptureMessage(t("record.validation.needMoreExamples", language).replace("{count}", String(MIN_EXAMPLES)));
      return;
    }

    setSaving(true);
    setSaveError(null);
    try {
      if (appendGestureId) {
        await updatePersonalizedGesture(appendGestureId, { examples: [...existingExamples, ...examples] });
      } else {
        await savePersonalizedGesture({
          name: name.trim(),
          meaning: meaning.trim(),
          localizedMeanings: cleanLocalizedMeanings(localizedMeanings),
          examples,
        });
      }
      setSaved(true);
      stopCameraAndModel();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  }

  const statusMessage = friendlyStatus(cameraPhase, cameraMessage, modelReady, readiness, language);
  const providedTranslationCount = Object.values(localizedMeanings).filter((v) => v && v.trim().length > 0).length;
  const languagesSummary = [
    t("language.en", language),
    ...TRANSLATABLE_LANGUAGES.filter((l) => localizedMeanings[l.code]?.trim()).map((l) => t(`language.${l.code.slice(0, 2)}`, language)),
  ].join(" + ");

  if (loadError) {
    return (
      <div className={`flex min-h-screen items-center justify-center bg-slate-50 p-6 font-sans ${pageAccessibilityClasses(a11y)}`}>
        <div className="w-full max-w-md rounded-xl bg-white p-6 text-center shadow-lg">
          <p className="text-sm text-red-700">{loadError}</p>
        </div>
      </div>
    );
  }

  if (saved) {
    return (
      <div className={`flex min-h-screen items-center justify-center bg-slate-50 p-6 font-sans ${pageAccessibilityClasses(a11y)}`}>
        <div className="w-full max-w-md space-y-4 rounded-xl bg-white p-6 text-center shadow-lg">
          <p className="text-3xl">✓</p>
          <p className="text-lg font-semibold text-emerald-700">{t("record.saved", language)}</p>
          <div className="flex flex-col gap-2 pt-2">
            <button
              type="button"
              onClick={() => chrome.tabs.create({ url: chrome.runtime.getURL("validate.html") })}
              className="w-full rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700"
            >
              {t("record.saved.testGesture", language)}
            </button>
            {!appendGestureId && (
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="w-full rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
              >
                {t("record.saved.createAnother", language)}
              </button>
            )}
            <button
              type="button"
              onClick={() => void closeThisTab()}
              className="w-full text-xs font-medium text-slate-400 hover:text-slate-600"
            >
              {t("record.saved.backToDashboard", language)}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`flex min-h-screen items-center justify-center bg-slate-50 p-6 font-sans ${pageAccessibilityClasses(a11y)}`}>
      <div className="w-full max-w-md space-y-5 rounded-xl bg-white p-6 shadow-lg">
        <header className="space-y-2">
          <h1 className="text-lg font-semibold text-slate-900">
            {appendGestureId ? t("record.title.append", language) : t("record.title.create", language)}
          </h1>
          <p className="text-sm text-slate-500">
            {appendGestureId ? t("record.subtitle.append", language) : t("record.subtitle.create", language)}
          </p>
          <StepIndicator
            current={step}
            total={4}
            label={t("record.stepIndicator", language).replace("{current}", String(step)).replace("{total}", "4")}
          />
        </header>

        {step === 1 && !appendGestureId && (
          <div className="space-y-4">
            <div>
              <h2 className="text-sm font-semibold text-slate-800">{t("record.step1.heading", language)}</h2>
              <label className="mt-2 block text-xs font-semibold uppercase tracking-wide text-slate-500" htmlFor="gesture-name">
                {t("record.step1.nameLabel", language)}
              </label>
              <input
                id="gesture-name"
                type="text"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder={t("record.step1.namePlaceholder", language)}
                className="mt-1 w-full rounded-md border border-slate-200 px-2.5 py-1.5 text-sm text-slate-900 focus:border-brand-500 focus:outline-none"
              />
              {nameError && <p className="mt-1 text-xs text-red-600">{nameError}</p>}
            </div>

            <div>
              <p className="text-sm font-semibold text-slate-800">{t("record.step1.meaningHeading", language)}</p>
              <label className="mt-2 block text-xs font-semibold uppercase tracking-wide text-slate-500" htmlFor="gesture-meaning">
                {t("record.step1.meaningLabel", language)}
              </label>
              <input
                id="gesture-meaning"
                type="text"
                value={meaning}
                onChange={(event) => setMeaning(event.target.value)}
                placeholder={t("record.step1.meaningPlaceholder", language)}
                className="mt-1 w-full rounded-md border border-slate-200 px-2.5 py-1.5 text-sm text-slate-900 focus:border-brand-500 focus:outline-none"
              />
              {meaningError && <p className="mt-1 text-xs text-red-600">{meaningError}</p>}
            </div>

            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                {t("record.step1.translationsHeading", language)}
              </p>
              <p className="mt-0.5 text-xs text-slate-400">{t("record.step1.translationsHint", language)}</p>
              <div className="mt-2 space-y-2">
                {TRANSLATABLE_LANGUAGES.map((lang) => (
                  <div key={lang.code}>
                    <label className="block text-xs font-medium text-slate-500" htmlFor={`translation-${lang.code}`}>
                      {t(`language.${lang.code.slice(0, 2)}`, language)}
                    </label>
                    <input
                      id={`translation-${lang.code}`}
                      type="text"
                      value={localizedMeanings[lang.code] ?? ""}
                      onChange={(event) =>
                        setLocalizedMeanings((prev) => ({ ...prev, [lang.code]: event.target.value }))
                      }
                      className="mt-0.5 w-full rounded-md border border-slate-200 px-2.5 py-1.5 text-sm text-slate-900 focus:border-brand-500 focus:outline-none"
                    />
                  </div>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-between border-t border-slate-100 pt-3">
              <button type="button" onClick={handleCancel} className="rounded-md px-2 py-1 text-xs font-medium text-slate-500 hover:bg-slate-100">
                {t("record.nav.cancel", language)}
              </button>
              <button
                type="button"
                onClick={goToStep2}
                className="rounded-md bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-700"
              >
                {t("record.nav.continue", language)}
              </button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-3">
            <p className="text-sm font-semibold text-slate-800">{t("record.step2.heading", language)}</p>
            <div className="space-y-1.5">
              <div className="relative">
                <video
                  ref={videoRef}
                  autoPlay
                  muted
                  playsInline
                  aria-label={t("record.cameraPreview", language)}
                  className="aspect-video w-full rounded-lg bg-slate-900 object-cover"
                />
                <CameraGuideOverlay />
              </div>
              <p className="flex items-center gap-1.5 text-sm text-slate-600" aria-live="polite">
                <span className={`inline-block h-2 w-2 rounded-full ${readiness.ready ? "bg-emerald-500" : "bg-amber-400"}`} />
                {statusMessage}
              </p>
            </div>
            <ul className="list-inside list-disc space-y-0.5 text-xs text-slate-500">
              <li>{t("record.step2.tip1", language)}</li>
              <li>{t("record.step2.tip2", language)}</li>
              <li>{t("record.step2.tip3", language)}</li>
            </ul>
            <div className="flex items-center justify-between border-t border-slate-100 pt-3">
              {!appendGestureId ? (
                <button type="button" onClick={() => setStep(1)} className="rounded-md px-2 py-1 text-xs font-medium text-slate-500 hover:bg-slate-100">
                  {t("record.nav.back", language)}
                </button>
              ) : (
                <button type="button" onClick={handleCancel} className="rounded-md px-2 py-1 text-xs font-medium text-slate-500 hover:bg-slate-100">
                  {t("record.nav.cancel", language)}
                </button>
              )}
              <button
                type="button"
                onClick={() => setStep(3)}
                disabled={cameraPhase !== "granted" || !modelReady}
                className="rounded-md bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {t("record.nav.continue", language)}
              </button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-3">
            <p className="text-sm font-semibold text-slate-800">{t("record.step3.heading", language)}</p>

            <div className="space-y-1.5">
              <div className="relative">
                <video
                  ref={videoRef}
                  autoPlay
                  muted
                  playsInline
                  aria-label={t("record.cameraPreview", language)}
                  className="aspect-video w-full rounded-lg bg-slate-900 object-cover"
                />
                <CameraGuideOverlay />
              </div>
              <p className="flex items-center gap-1.5 text-sm text-slate-600" aria-live="polite">
                <span className={`inline-block h-2 w-2 rounded-full ${readiness.ready ? "bg-emerald-500" : "bg-amber-400"}`} />
                {statusMessage}
              </p>
            </div>

            <div>
              <div className="mb-1 flex items-center justify-between text-xs text-slate-500">
                <span>{t("record.step3.examplesCaptured", language)}</span>
                <span className="font-medium text-slate-700">
                  {examples.length} / {MIN_EXAMPLES}
                  {examples.length >= RECOMMENDED_MAX_EXAMPLES ? " ✓" : ""}
                </span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
                <div
                  className="h-full rounded-full bg-brand-500"
                  style={{ width: `${Math.min(100, (examples.length / MIN_EXAMPLES) * 100)}%` }}
                />
              </div>
            </div>

            <ul className="list-inside list-disc space-y-0.5 text-xs text-slate-500">
              <li>{t("record.step3.tip1", language)}</li>
              <li>{t("record.step3.tip2", language)}</li>
              <li>{t("record.step3.tip3", language)}</li>
              <li>{t("record.step3.tip4", language)}</li>
            </ul>

            <div className="flex items-center justify-between">
              <span className="text-xs text-slate-400">
                {appendGestureId && existingExamples.length > 0 ? `+${existingExamples.length} already saved` : null}
              </span>
              <button
                type="button"
                onClick={handleCapture}
                disabled={!readiness.ready}
                className="rounded-md bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {t("record.step3.captureButton", language)}
              </button>
            </div>

            {captureMessage && (
              <p className="text-xs text-slate-500" aria-live="polite">
                {captureMessage}
              </p>
            )}

            {examples.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {examples.map((_, index) => (
                  <span key={index} className="flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                    #{index + 1}
                    <button
                      type="button"
                      onClick={() => handleRemoveExample(index)}
                      aria-label={`${t("record.removeExample", language)} ${index + 1}`}
                      className="text-slate-400 hover:text-red-600"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}

            <div className="flex items-center justify-between border-t border-slate-100 pt-3">
              <div className="flex gap-2">
                {!appendGestureId && (
                  <button type="button" onClick={() => setStep(2)} className="rounded-md px-2 py-1 text-xs font-medium text-slate-500 hover:bg-slate-100">
                    {t("record.nav.back", language)}
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleResetAll}
                  disabled={examples.length === 0}
                  className="rounded-md px-2 py-1 text-xs font-medium text-slate-500 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {t("record.nav.resetAll", language)}
                </button>
              </div>
              <button
                type="button"
                onClick={() => setStep(4)}
                disabled={!hasEnoughExamples(examples.length)}
                className="rounded-md bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {t("record.nav.continue", language)}
              </button>
            </div>
          </div>
        )}

        {step === 4 && (
          <div className="space-y-3">
            <p className="text-sm font-semibold text-slate-800">{t("record.step4.heading", language)}</p>
            <div className="space-y-1.5 rounded-lg bg-slate-50 p-3 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-500">{t("record.step4.gestureLabel", language)}</span>
                <span className="font-medium text-slate-800">{name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">{t("record.step4.meaningLabel", language)}</span>
                <span className="font-medium text-slate-800">{meaning}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">{t("record.step4.examplesLabel", language)}</span>
                <span className="font-medium text-slate-800">
                  {appendGestureId ? existingExamples.length + examples.length : examples.length}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">{t("record.step4.languagesLabel", language)}</span>
                <span className="font-medium text-slate-800">
                  {providedTranslationCount > 0 ? languagesSummary : t("language.en", language)}
                </span>
              </div>
            </div>

            <div className="flex items-center justify-between border-t border-slate-100 pt-3">
              <button type="button" onClick={() => setStep(3)} className="rounded-md px-2 py-1 text-xs font-medium text-slate-500 hover:bg-slate-100">
                {t("record.nav.back", language)}
              </button>
              <button
                type="button"
                onClick={() => void handleSave()}
                disabled={saving}
                className="rounded-md bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {saving ? t("record.saving", language) : appendGestureId ? t("record.step4.saveExamplesButton", language) : t("record.step4.saveButton", language)}
              </button>
            </div>
            {saveError && <p className="text-xs text-red-600">{saveError}</p>}
          </div>
        )}
      </div>
    </div>
  );
}
