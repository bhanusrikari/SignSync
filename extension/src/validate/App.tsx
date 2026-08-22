import { useCallback, useEffect, useMemo, useState } from "react";
import { getPersonalizedGestures, mergePersonalizedGestures } from "@/services/personalizedGestures";
import {
  summarizeRecognitionStrength,
  validatePersonalizedGestures,
  type GestureValidationResult,
  type PersonalizedGestureValidationReport,
  type RepresentationStats,
} from "@/ai/personalizedGestureValidation";
import { t } from "@/i18n";
import { sendToBackground } from "@/utils/messaging";
import { DEFAULT_STATE, LANGUAGES } from "@/shared/constants";
import { pageAccessibilityClasses } from "@/shared/accessibilityClasses";
import type { LanguageCode, SignSyncState } from "@/types";

function formatNumber(value: number | null): string {
  return value === null ? "—" : value.toFixed(4);
}

/** Friendly, non-technical card for one gesture (Phase 10 Part 4) -- name,
 *  meaning, a ready/needs-work status, example count, and a strength bar.
 *  No raw IDs, distances, or thresholds -- those live in GestureCard below,
 *  shown only when "Advanced diagnostics" is on. */
function FriendlyGestureCard({ result, language }: { result: GestureValidationResult; language: LanguageCode }) {
  const strength = summarizeRecognitionStrength(result);
  const strengthLabel =
    strength === "strong"
      ? t("validate.strength.strong", language)
      : strength === "fair"
        ? t("validate.strength.fair", language)
        : t("validate.strength.weak", language);
  const strengthWidth = strength === "strong" ? "100%" : strength === "fair" ? "60%" : "25%";
  const strengthColor = strength === "strong" ? "bg-emerald-500" : strength === "fair" ? "bg-amber-500" : "bg-red-400";
  const ready = result.hasEnoughExamples && strength !== "weak";

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <h3 className="text-lg font-bold uppercase text-slate-900">{result.displayName}</h3>
      <p className="text-sm text-slate-600">{result.meaning}</p>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium ${ready ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>
          {ready ? "✓" : "…"} {ready ? t("validate.status.ready", language) : t("validate.status.needsWork", language)}
        </span>
        <span
          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${result.enabled ? "bg-slate-100 text-slate-600" : "bg-red-50 text-red-600"}`}
        >
          {result.enabled ? t("validate.enabled", language) : t("validate.disabledLabel", language)}
        </span>
        <span className="text-slate-400">
          {result.exampleCount} {t("validate.examples", language)}
        </span>
      </div>

      <div className="mt-3">
        <div className="mb-1 flex items-center justify-between text-xs text-slate-500">
          <span>{t("validate.recognitionStrength", language)}</span>
          <span className="font-medium text-slate-700">{strengthLabel}</span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
          <div className={`h-full rounded-full ${strengthColor}`} style={{ width: strengthWidth }} />
        </div>
      </div>

      <p className="mt-2 text-xs text-slate-500">
        {t("validate.translations", language)}{" "}
        {Object.values(LANGUAGES)
          .filter((l) => l.code !== "en-IN" && result.localizedMeanings?.[l.code])
          .map((l) => t(`language.${l.code.slice(0, 2)}`, language))
          .join(", ") || t("validate.translations.englishOnly", language)}
      </p>

      {result.insufficientDataMessage && (
        <p className="mt-2 text-xs text-amber-700">{result.insufficientDataMessage}</p>
      )}
    </div>
  );
}

function StatsTable({ label, stats }: { label: string; stats: RepresentationStats | null }) {
  if (!stats) return null;
  return (
    <div className="rounded-md bg-slate-50 px-2.5 py-2 text-xs text-slate-600">
      <div className="mb-1 font-semibold text-slate-700">{label}</div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
        <span>Matched</span>
        <span className={stats.failureCount > 0 ? "font-semibold text-amber-600" : "text-slate-700"}>
          {stats.matchedCount} / {stats.evaluatedCount}
        </span>
        <span>Distance (min / avg / max)</span>
        <span>
          {formatNumber(stats.minDistance)} / {formatNumber(stats.avgDistance)} / {formatNumber(stats.maxDistance)}
        </span>
        <span>Confidence range</span>
        <span>
          {formatNumber(stats.minConfidence)} – {formatNumber(stats.maxConfidence)}
        </span>
      </div>
    </div>
  );
}

function GestureCard({ result }: { result: GestureValidationResult }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-slate-900">{result.displayName}</h3>
          <p className="font-mono text-[11px] text-slate-400">ID: {result.shortId}</p>
        </div>
        <div className="flex items-center gap-1.5 text-xs">
          {!result.enabled && (
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-500">Disabled</span>
          )}
          <span
            className={`rounded-full px-2 py-0.5 ${
              result.hasEnoughExamples ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"
            }`}
          >
            {result.exampleCount} example{result.exampleCount === 1 ? "" : "s"}
          </span>
          <button
            type="button"
            onClick={() =>
              chrome.tabs.create({ url: chrome.runtime.getURL(`record.html?gestureId=${result.gestureId}`) })
            }
            className="rounded-md border border-dashed border-slate-200 px-2 py-0.5 text-slate-500 hover:border-brand-300 hover:text-brand-600"
          >
            + Add examples
          </button>
        </div>
      </div>

      {result.insufficientDataMessage ? (
        <p className="mt-2 text-xs text-amber-700">{result.insufficientDataMessage}</p>
      ) : (
        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
          <StatsTable label="Existing representation" stats={result.leaveOneOut.baseline} />
          <StatsTable label="Rotation-invariant representation" stats={result.leaveOneOut.rotationInvariant} />
        </div>
      )}
    </div>
  );
}

function PairsTable({ pairs }: { pairs: PersonalizedGestureValidationReport["crossGesturePairs"] }) {
  if (pairs.length === 0) {
    return <p className="text-sm text-slate-500">No concerning gesture pairs found.</p>;
  }
  return (
    <div className="space-y-2">
      {pairs.map((pair) => {
        const isProblem = pair.falsePositiveBaseline || pair.falsePositiveRotationInvariant;
        return (
          <div
            key={`${pair.gestureAId}-${pair.gestureBId}`}
            className={`rounded-lg border p-3 text-sm ${
              isProblem ? "border-red-200 bg-red-50" : "border-amber-200 bg-amber-50"
            }`}
          >
            <div className="font-semibold text-slate-900">
              {pair.gestureAName} ↔ {pair.gestureBName}
            </div>
            <div className="font-mono text-[11px] text-slate-400">
              {pair.gestureAShortId} ↔ {pair.gestureBShortId}
            </div>
            <div className="mt-0.5 text-xs text-slate-600">{pair.flagLabel}</div>
            <div className="mt-1.5 grid grid-cols-2 gap-x-3 text-xs text-slate-600">
              <span>Closest examples</span>
              <span>
                #{pair.closestExampleIndexA + 1} ↔ #{pair.closestExampleIndexB + 1}
              </span>
              <span>Closest distance (existing)</span>
              <span>{formatNumber(pair.bestDistanceBaseline)}</span>
              <span>Closest distance (rotation-invariant)</span>
              <span>{formatNumber(pair.bestDistanceRotationInvariant)}</span>
              <span>Contradiction protection fired</span>
              <span>{pair.contradictionDetected ? "Yes" : "No"}</span>
              <span>False positive detected</span>
              <span className={isProblem ? "font-semibold text-red-700" : ""}>
                {isProblem ? "Yes" : "No"}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Explicit, user-confirmed merge UI for gestures that share a name --
 * "same name" is only ever a HINT that they might be the same intended
 * gesture (see the Phase 8.5 report's Step 7); nothing here merges
 * automatically. The user picks which record is canonical (defaulting to
 * whichever currently has the most examples) and must click through an
 * explicit, clearly-labeled delete warning before anything happens.
 */
function DuplicateNameGroupCard({
  name,
  gestures,
  onMerge,
  merging,
}: {
  name: string;
  gestures: GestureValidationResult[];
  onMerge: (canonicalId: string, sourceIds: string[]) => void;
  merging: boolean;
}) {
  const defaultCanonicalId = useMemo(
    () => gestures.reduce((best, g) => (g.exampleCount > best.exampleCount ? g : best), gestures[0]).gestureId,
    [gestures],
  );
  const [canonicalId, setCanonicalId] = useState(defaultCanonicalId);

  const canonical = gestures.find((g) => g.gestureId === canonicalId) ?? gestures[0];
  const sourceIds = gestures.filter((g) => g.gestureId !== canonicalId).map((g) => g.gestureId);
  const totalExamplesBeforeValidation = gestures.reduce((sum, g) => sum + g.exampleCount, 0);

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm">
      <div className="font-semibold text-slate-900">Duplicate gesture names detected: "{name}"</div>
      <div className="mt-2 space-y-1.5">
        {gestures.map((g) => (
          <label key={g.gestureId} className="flex items-center gap-2 text-xs text-slate-700">
            <input
              type="radio"
              name={`canonical-${name}`}
              checked={canonicalId === g.gestureId}
              onChange={() => setCanonicalId(g.gestureId)}
              disabled={merging}
            />
            <span className="font-mono text-slate-400">{g.shortId}</span>
            <span>{g.displayName}</span>
            <span className="text-slate-500">— {g.exampleCount} examples</span>
          </label>
        ))}
      </div>

      <p className="mt-2 text-xs text-slate-600">
        Canonical: <span className="font-semibold">{canonical.displayName}</span> ({canonical.shortId}) — merged
        examples (before validation): {totalExamplesBeforeValidation}
      </p>
      <p className="mt-1 text-xs font-semibold text-red-700">
        This will permanently DELETE the other {sourceIds.length} record{sourceIds.length === 1 ? "" : "s"} (
        {gestures
          .filter((g) => g.gestureId !== canonicalId)
          .map((g) => g.shortId)
          .join(", ")}
        ) after moving their valid examples onto {canonical.shortId}. This cannot be undone.
      </p>

      <button
        type="button"
        onClick={() => onMerge(canonicalId, sourceIds)}
        disabled={merging || sourceIds.length === 0}
        className="mt-2 rounded-md bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {merging ? "Merging…" : `Merge and Delete ${sourceIds.length} Record${sourceIds.length === 1 ? "" : "s"}`}
      </button>
    </div>
  );
}

export function App() {
  const [report, setReport] = useState<PersonalizedGestureValidationReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [merging, setMerging] = useState(false);
  const [mergeMessage, setMergeMessage] = useState<string | null>(null);
  const [mergeError, setMergeError] = useState<string | null>(null);
  const [language, setLanguage] = useState<LanguageCode>(DEFAULT_STATE.language);
  // Defaults to SignSyncState.developerDiagnostics (Settings -> Advanced),
  // but stays independently togglable right here too (Phase 10 Part 4) --
  // this page's own switch never writes back to the global setting.
  const [showAdvanced, setShowAdvanced] = useState(DEFAULT_STATE.developerDiagnostics);
  const [a11y, setA11y] = useState({ highContrast: false, largeText: false, reducedMotion: false });

  const runValidation = useCallback(async () => {
    setLoading(true);
    const gestures = await getPersonalizedGestures();
    setReport(validatePersonalizedGestures(gestures));
    setLoading(false);
  }, []);

  useEffect(() => {
    void runValidation();
    sendToBackground<SignSyncState>({ type: "GET_STATE" }).then((state) => {
      setLanguage(state.language);
      setShowAdvanced(state.developerDiagnostics);
      setA11y({ highContrast: state.highContrast, largeText: state.largeText, reducedMotion: state.reducedMotion });
    });
  }, [runValidation]);

  const duplicateNameGroups = useMemo(() => {
    if (!report) return [];
    const byName = new Map<string, GestureValidationResult[]>();
    for (const gesture of report.gestures) {
      const group = byName.get(gesture.gestureName);
      if (group) group.push(gesture);
      else byName.set(gesture.gestureName, [gesture]);
    }
    return [...byName.entries()].filter(([, group]) => group.length > 1);
  }, [report]);

  async function handleMerge(canonicalId: string, sourceIds: string[]) {
    const confirmed = window.confirm(
      `Merge ${sourceIds.length} record(s) into the selected gesture and permanently delete them? This cannot be undone.`,
    );
    if (!confirmed) return;

    setMerging(true);
    setMergeError(null);
    setMergeMessage(null);
    try {
      const result = await mergePersonalizedGestures(sourceIds, canonicalId);
      setMergeMessage(
        `Merged ${result.validExamplesMerged} example(s) onto "${result.targetName}" ` +
          `(${result.finalExampleCount} total${result.malformedExamplesSkipped > 0 ? `, ${result.malformedExamplesSkipped} malformed skipped` : ""}). ` +
          `Deleted ${result.deletedSourceGestureIds.length} duplicate record(s).`,
      );
      await runValidation();
    } catch (error) {
      setMergeError(error instanceof Error ? error.message : String(error));
    } finally {
      setMerging(false);
    }
  }

  return (
    <div className={`min-h-screen bg-slate-50 p-6 font-sans ${pageAccessibilityClasses(a11y)}`}>
      <div className="mx-auto max-w-2xl space-y-5">
        <header className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold text-slate-900">{t("validate.title", language)}</h1>
          </div>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-1.5 text-xs text-slate-500">
              <input
                type="checkbox"
                checked={showAdvanced}
                onChange={(event) => setShowAdvanced(event.target.checked)}
              />
              {t("validate.advancedDiagnostics", language)}
            </label>
            <button
              type="button"
              onClick={() => void runValidation()}
              disabled={loading}
              className="rounded-md bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? "Checking…" : "Refresh"}
            </button>
          </div>
        </header>

        {loading && <p className="text-sm text-slate-500">Loading your saved gestures…</p>}

        {!loading && report && (
          <>
            {mergeMessage && (
              <div className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700">{mergeMessage}</div>
            )}
            {mergeError && <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{mergeError}</div>}

            {duplicateNameGroups.length > 0 && (
              <section className="space-y-2">
                <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                  Duplicate names -- explicit merge available
                </h2>
                {duplicateNameGroups.map(([name, gestures]) => (
                  <DuplicateNameGroupCard key={name} name={name} gestures={gestures} onMerge={handleMerge} merging={merging} />
                ))}
              </section>
            )}

            {report.gestureCount === 0 ? (
              <div className="rounded-lg border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-500">
                {t("validate.empty.title", language)}
                <br />
                <span className="font-medium text-slate-700">{t("validate.empty.action", language)}</span> —
                open the SignSync popup and choose "My Gestures", then come back and click Refresh.
              </div>
            ) : showAdvanced ? (
              <>
                <div className="rounded-lg bg-white p-3 text-sm text-slate-700 shadow-sm">{report.summary}</div>
                <section className="space-y-2">
                  <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                    Stored gesture data
                  </h2>
                  {report.gestures.map((result) => (
                    <GestureCard key={result.gestureId} result={result} />
                  ))}
                </section>

                <section className="space-y-2">
                  <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                    Cross-gesture check (false positives / ambiguous pairs)
                  </h2>
                  <PairsTable pairs={report.crossGesturePairs} />
                </section>
              </>
            ) : (
              <section className="space-y-2">
                {report.gestures.map((result) => (
                  <FriendlyGestureCard key={result.gestureId} result={result} language={language} />
                ))}
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}
