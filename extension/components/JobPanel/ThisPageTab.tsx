import { useState } from "react";
import { formatSalary } from "../../lib/formatSalary";
import { learnedSelectors } from "../../services/learnedSelectors";
import type { ExtractionStrategy, JobAnalysis, JobPanelError, SavedJob } from "../../types/job";
import { ArrangementBadge } from "./ArrangementBadge";
import { FitScore } from "./FitScore";
import { UsageExhausted } from "../UsageExhausted";

export type JobViewStatus = "idle" | "analyzing" | "ready" | "error";

export interface JobView {
  status: JobViewStatus;
  analysis: JobAnalysis | null;
  error: JobPanelError | null;
  fallback: Partial<JobAnalysis> | null;
  canonicalUrl: string | null;
  sourceUrl: string | null;
  multiplePostings: boolean;
  cached: boolean;
  saved: SavedJob | null;
  /** How this result was produced (spec FR-035) — drives the learned-region badge (FR-032). */
  strategy?: ExtractionStrategy;
  /** Present when `strategy` is "picked"/"selection" — offers the always-analyze prompt (FR-026b). */
  scopedRegion?: { selector: string; host: string };
}

interface ThisPageTabProps {
  view: JobView;
  saveError?: string | null;
  onAnalyze: () => void;
  onCancel: () => void;
  onForceAnalyze: () => void;
  onReanalyze?: () => void;
  onSave?: () => void;
  onExport?: () => void;
  onPruneArchived?: () => void;
  onUpgrade?: () => void;
  /** Opens the paste composer (spec FR-017e) — the sole remedy on a no-access page. */
  onOpenPaste?: () => void;
}

export function ThisPageTab({
  view,
  saveError,
  onAnalyze,
  onCancel,
  onForceAnalyze,
  onReanalyze,
  onSave,
  onExport,
  onPruneArchived,
  onUpgrade,
  onOpenPaste,
}: ThisPageTabProps) {
  if (view.status === "idle") {
    return (
      <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
        <p className="text-sm font-medium text-gray-600 dark:text-gray-400">
          Analyze the current page as a job posting
        </p>
        <button
          onClick={onAnalyze}
          className="mt-4 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-700"
        >
          Analyze this page
        </button>
      </div>
    );
  }

  if (view.status === "analyzing") {
    return (
      <div
        role="status"
        aria-label="Analyzing page, please wait"
        aria-live="polite"
        className="flex flex-col items-center justify-center px-4 py-16"
      >
        <div
          className="h-10 w-10 animate-spin rounded-full border-[3px] border-gray-200 border-t-blue-600 dark:border-gray-700 dark:border-t-blue-500"
          aria-hidden="true"
        />
        <p className="mt-4 text-sm text-gray-500 dark:text-gray-400">Analyzing page…</p>
        <button
          onClick={onCancel}
          className="mt-4 rounded-md px-3 py-1 text-xs font-medium text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-800"
        >
          Cancel
        </button>
      </div>
    );
  }

  if (view.status === "error" && view.error) {
    // The exhausted state is a designed card, never the generic error
    // banner (FR-009/SC-003) — saved jobs/profile/history are unaffected,
    // since this branch only ever replaces the "This Page" analyze result.
    if (view.error.code === "usage-limit-reached" && view.error.usage) {
      return (
        <div className="p-4">
          <UsageExhausted
            usage={view.error.usage}
            onUpgrade={onUpgrade ?? (() => chrome.runtime.openOptionsPage())}
          />
        </div>
      );
    }

    // Action hierarchy (FR-007b): Retry is primary (a filled button, free
    // and needs no further input); a paste shortcut is the quietest action —
    // a plain-text link, not a button — since paste is the remedy for pages
    // the other actions cannot fix (a login wall, a bot check, a no-access
    // page), not a first response to an ordinary parsing miss.
    const showPasteShortcut =
      onOpenPaste &&
      (view.error.code === "thin-content" || view.error.code === "no-access");

    return (
      <div className="space-y-4 p-4">
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 dark:border-red-900/50 dark:bg-red-950/30">
          <p className="text-sm font-semibold text-red-800 dark:text-red-400">
            {view.error.message}
          </p>
          <p className="mt-1 text-sm text-red-700 dark:text-red-500">
            {view.error.action}
          </p>
          <div className="mt-3 flex items-center gap-3">
            {view.error.retryable && (
              <button
                onClick={onAnalyze}
                className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700"
              >
                Retry
              </button>
            )}
            {showPasteShortcut && (
              <button
                onClick={onOpenPaste}
                className="text-xs font-medium text-red-700 underline hover:text-red-800 dark:text-red-400 dark:hover:text-red-300"
              >
                Paste text instead
              </button>
            )}
          </div>
        </div>
        {view.fallback && (
          <section aria-label="Fields extracted from page data">
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">
              From page data (analysis unavailable)
            </h2>
            <AnalysisFields analysis={view.fallback} />
          </section>
        )}
      </div>
    );
  }

  if (view.status === "ready" && view.analysis) {
    if (!view.analysis.isJobPosting) {
      return (
        <div className="p-4">
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-900/50 dark:bg-amber-950/30">
            <p className="text-sm font-semibold text-amber-800 dark:text-amber-400">
              This doesn&apos;t look like a job posting
            </p>
            <p className="mt-1 text-sm text-amber-700 dark:text-amber-500">
              You can analyze it anyway if this really is a job posting.
            </p>
            <button
              onClick={onForceAnalyze}
              className="mt-3 rounded-md bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-700"
            >
              Analyze anyway
            </button>
          </div>
        </div>
      );
    }

    return (
      <div className="space-y-4 p-4">
        {view.strategy === "learned-selector" && view.canonicalUrl && (
          <p className="text-xs font-medium text-blue-600 dark:text-blue-400">
            Always analyzing this region on {hostOf(view.canonicalUrl)}
          </p>
        )}
        {(view.strategy === "picked" || view.strategy === "selection") &&
          view.scopedRegion && <AlwaysAnalyzeOffer scopedRegion={view.scopedRegion} />}
        {view.multiplePostings && (
          <p className="rounded-lg bg-gray-100 px-3 py-2 text-xs text-gray-600 dark:bg-gray-800 dark:text-gray-400">
            Multiple postings were found on this page; the first one was
            analyzed. A page for a single posting yields better results.
          </p>
        )}
        {view.saved && (
          <div className="rounded-xl border border-green-200 bg-green-50 p-3 dark:border-green-900/50 dark:bg-green-950/30">
            <p className="text-xs font-semibold text-green-800 dark:text-green-300">
              Already saved · status: {view.saved.status}
            </p>
            {view.saved.notes && (
              <p className="mt-1 whitespace-pre-wrap text-xs text-green-700 dark:text-green-400">
                {view.saved.notes}
              </p>
            )}
            <p className="mt-1 text-[10px] text-green-600/80 dark:text-green-500/80">
              Saved {new Date(view.saved.savedAt).toLocaleDateString()} — edit in
              the Saved tab.
            </p>
          </div>
        )}
        <div className="flex items-center gap-2">
          {onSave && !view.saved && (
            <button
              onClick={onSave}
              className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-blue-700"
            >
              Save
            </button>
          )}
          {onReanalyze && (
            <button
              onClick={onReanalyze}
              className="rounded-md px-3 py-1.5 text-xs font-medium text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-800"
            >
              Re-analyze
            </button>
          )}
          {view.cached && !view.saved && (
            <span className="text-[10px] text-gray-400 dark:text-gray-500">
              from cache
            </span>
          )}
        </div>
        {saveError && (
          <div
            role="alert"
            className="rounded-xl border border-amber-200 bg-amber-50 p-3 dark:border-amber-900/50 dark:bg-amber-950/30"
          >
            <p className="text-xs font-semibold text-amber-800 dark:text-amber-400">
              {saveError}
            </p>
            <div className="mt-2 flex gap-2">
              {onExport && (
                <button
                  onClick={onExport}
                  className="rounded-md bg-amber-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-amber-700"
                >
                  Export library
                </button>
              )}
              {onPruneArchived && (
                <button
                  onClick={onPruneArchived}
                  className="rounded-md px-2.5 py-1 text-xs font-semibold text-amber-800 hover:bg-amber-100 dark:text-amber-300 dark:hover:bg-amber-900/40"
                >
                  Prune archived
                </button>
              )}
            </div>
          </div>
        )}
        <FitScore fit={view.analysis.fit} />
        <AnalysisFields analysis={view.analysis} />
      </div>
    );
  }

  return null;
}

export function AnalysisFields({ analysis }: { analysis: Partial<JobAnalysis> }) {
  return (
    <div className="space-y-3">
      {(analysis.title || analysis.company) && (
        <div>
          {analysis.title && (
            <h2 className="text-base font-semibold text-gray-800 dark:text-gray-100">
              {analysis.title}
            </h2>
          )}
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {[analysis.company, analysis.location].filter(Boolean).join(" — ")}
          </p>
        </div>
      )}

      {analysis.arrangement && (
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <ArrangementBadge
              arrangement={analysis.arrangement}
              daysInOffice={analysis.daysInOffice ?? null}
              daysRemote={analysis.daysRemote ?? null}
            />
            {analysis.arrangement !== "unspecified" &&
              analysis.arrangementConfidence &&
              analysis.arrangementConfidence !== "none" && (
                <span className="text-xs text-gray-400 dark:text-gray-500">
                  {analysis.arrangementConfidence === "explicit"
                    ? "stated in posting"
                    : "inferred"}
                </span>
              )}
          </div>
          {analysis.arrangementEvidence && (
            <blockquote className="border-l-2 border-gray-300 pl-2 text-xs italic text-gray-500 dark:border-gray-700 dark:text-gray-400">
              “{analysis.arrangementEvidence}”
            </blockquote>
          )}
          {analysis.remoteRestrictions && (
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Remote restrictions: {analysis.remoteRestrictions}
            </p>
          )}
        </div>
      )}

      <dl className="space-y-1.5 text-sm">
        {analysis.salary && (
          <Field label="Salary" value={formatSalary(analysis.salary)} />
        )}
        {analysis.seniority && analysis.seniority !== "unspecified" && (
          <Field label="Seniority" value={capitalize(analysis.seniority)} />
        )}
      </dl>

      {analysis.techStack && analysis.techStack.length > 0 && (
        <div>
          <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">
            Tech stack
          </h3>
          <ul aria-label="Tech stack" className="flex flex-wrap gap-1.5">
            {analysis.techStack.map((tech) => (
              <li
                key={tech}
                className="rounded-md bg-gray-100 px-2 py-0.5 text-xs text-gray-700 dark:bg-gray-800 dark:text-gray-300"
              >
                {tech}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <dt className="w-20 shrink-0 text-gray-400 dark:text-gray-500">{label}</dt>
      <dd className="text-gray-700 dark:text-gray-200">{value}</dd>
    </div>
  );
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

/**
 * Offered after a successful scoped analysis, never imposed by the act of
 * scoping (spec FR-026b) — a one-off correction on an unusual posting must
 * not silently teach a selector that misapplies to every posting on the
 * host. Accepting writes straight to `learnedSelectors` (chrome.storage.local
 * is reachable from any extension context; no background round-trip needed)
 * and shows a confirmation naming the site — declining leaves nothing
 * learned and shows nothing further.
 */
function AlwaysAnalyzeOffer({
  scopedRegion,
}: {
  scopedRegion: { selector: string; host: string };
}) {
  const [state, setState] = useState<"offering" | "accepted" | "declined">("offering");

  if (state === "declined") return null;

  if (state === "accepted") {
    return (
      <p className="rounded-lg bg-blue-50 px-3 py-2 text-xs font-medium text-blue-700 dark:bg-blue-950/40 dark:text-blue-300">
        Will always analyze this region on {scopedRegion.host}.
      </p>
    );
  }

  return (
    <div className="flex items-center justify-between gap-2 rounded-lg bg-gray-100 px-3 py-2 dark:bg-gray-800">
      <p className="text-xs text-gray-600 dark:text-gray-400">
        Always analyze this region on {scopedRegion.host}?
      </p>
      <div className="flex shrink-0 gap-2">
        <button
          onClick={() => {
            void learnedSelectors.put(scopedRegion.host, scopedRegion.selector);
            setState("accepted");
          }}
          className="rounded-md bg-blue-600 px-2 py-1 text-xs font-semibold text-white hover:bg-blue-700"
        >
          Always
        </button>
        <button
          onClick={() => setState("declined")}
          className="rounded-md px-2 py-1 text-xs font-medium text-gray-500 hover:bg-gray-200 dark:text-gray-400 dark:hover:bg-gray-700"
        >
          Not now
        </button>
      </div>
    </div>
  );
}
