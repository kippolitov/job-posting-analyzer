import { useEffect, useRef, useState } from "react";
import { formatSalary } from "../../lib/formatSalary";
import { learnedSelectors } from "../../services/learnedSelectors";
import { pickerService } from "../../services/pickerService";
import { RegionList } from "./RegionList";
import type { ExtractionStrategy, JobAnalysis, JobPanelError, SavedJob } from "../../types/job";
import { ArrangementBadge } from "./ArrangementBadge";
import { FitScore } from "./FitScore";
import { useLiveFingerprint, useRescoreCostLine } from "./useFreshness";
import { freshness, rescoreAction, scoredByLabel } from "../../../shared/fitView";
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
  /** `undefined` = unknown, `null` = the account has no profile (006 R7). */
  currentProfileFingerprint?: string | null;
  profileUnavailable?: boolean;
  postingUnavailable?: boolean;
  /** A rescore failed; `analysis` is the stored one, still out of date. */
  rescoreError?: JobPanelError | null;
}

interface ThisPageTabProps {
  tabId: number | null;
  view: JobView;
  saveError?: string | null;
  onAnalyze: () => void;
  onCancel: () => void;
  onForceAnalyze: () => void;
  onReanalyze?: () => void;
  /** Rescore against the current profile; the argument is the fit's own fingerprint. */
  onRescore?: (priorFingerprint: string | null) => void;
  onSave?: () => void;
  onExport?: () => void;
  onPruneArchived?: () => void;
  onUpgrade?: () => void;
  /** Opens the paste composer (spec FR-017e) — the sole remedy on a no-access page. */
  onOpenPaste?: () => void;
  /** A region was committed via the picker or the panel's keyboard list (spec FR-026). */
  onRegionCommitted?: (result: { text: string; selector: string }) => void;
}

export function ThisPageTab({
  tabId,
  view,
  saveError,
  onAnalyze,
  onCancel,
  onForceAnalyze,
  onReanalyze,
  onRescore,
  onSave,
  onExport,
  onPruneArchived,
  onUpgrade,
  onOpenPaste,
  onRegionCommitted,
}: ThisPageTabProps) {
  // FR-023: reachable from a failed extraction AND from a successful-but-
  // wrong one. FR-036a: both scoping mechanisms need page access, so on a
  // no-access page the control is shown disabled with a stated reason
  // rather than hidden or present-and-broken.
  const [regionScopingOpen, setRegionScopingOpen] = useState(false);
  const regionButtonRef = useRef<HTMLButtonElement>(null);
  const noAccess = view.status === "error" && view.error?.code === "no-access";

  const currentFingerprint = useLiveFingerprint(view.currentProfileFingerprint);
  const fit = view.analysis?.fit ?? null;
  const fitFreshness = freshness(fit, currentFingerprint);
  const unavailable = Boolean(
    view.postingUnavailable || view.saved?.unavailableAt
  );
  const action = rescoreAction(
    {
      source: view.saved?.source ?? "url",
      sourceUrl: view.sourceUrl ?? "",
      saveKey: view.canonicalUrl ?? "",
      unavailableAt: view.saved?.unavailableAt,
    },
    fitFreshness,
    "panel"
  );
  const costLine = useRescoreCostLine(action.kind !== "none");

  const closeRegionScoping = (): void => {
    setRegionScopingOpen(false);
    regionButtonRef.current?.focus();
  };

  if (regionScopingOpen && tabId !== null) {
    return (
      <RegionScoping
        tabId={tabId}
        onCommit={(result) => {
          setRegionScopingOpen(false);
          onRegionCommitted?.(result);
        }}
        onCancel={closeRegionScoping}
      />
    );
  }

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

    // Action hierarchy (FR-007b, T090): Retry is primary (a filled button,
    // free and needs no further input); "Analyze a region" is secondary (an
    // outlined button — it needs the user to choose something); a paste
    // shortcut is the quietest action — a plain-text link, not a button —
    // since paste is the remedy for pages the other actions cannot fix (a
    // login wall, a bot check, a no-access page), not a first response to
    // an ordinary parsing miss.
    const showScopingAndPaste =
      view.error.code === "thin-content" || view.error.code === "no-access";

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
            {showScopingAndPaste && (
              <button
                ref={regionButtonRef}
                onClick={() => setRegionScopingOpen(true)}
                disabled={noAccess}
                aria-describedby={noAccess ? "region-disabled-reason" : undefined}
                className="rounded-md border border-red-300 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950/40"
              >
                Analyze a region
              </button>
            )}
            {showScopingAndPaste && onOpenPaste && (
              <button
                onClick={onOpenPaste}
                className="text-xs font-medium text-red-700 underline hover:text-red-800 dark:text-red-400 dark:hover:text-red-300"
              >
                Paste text instead
              </button>
            )}
          </div>
          {noAccess && (
            <p
              id="region-disabled-reason"
              className="mt-2 text-xs text-red-600/80 dark:text-red-400/80"
            >
              The extension can&apos;t read this page, so regions can&apos;t be
              analyzed here. Paste the text instead.
            </p>
          )}
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
          {/* FR-023: reachable from a successful-but-wrong result, too — the
              extraction can succeed and still have picked the wrong part of
              the page. */}
          <button
            ref={regionButtonRef}
            onClick={() => setRegionScopingOpen(true)}
            disabled={tabId === null}
            className="ml-auto text-xs font-medium text-gray-500 underline hover:text-gray-700 disabled:cursor-not-allowed disabled:opacity-40 dark:text-gray-400 dark:hover:text-gray-200"
          >
            Wrong region? Analyze a region
          </button>
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
        {view.rescoreError?.code === "usage-limit-reached" &&
        view.rescoreError.usage ? (
          <UsageExhausted
            usage={view.rescoreError.usage}
            onUpgrade={onUpgrade ?? (() => chrome.runtime.openOptionsPage())}
          />
        ) : view.rescoreError ? (
          <div
            role="alert"
            className="rounded-xl border border-amber-200 bg-amber-50 p-3 dark:border-amber-900/50 dark:bg-amber-950/30"
          >
            <p className="text-xs font-semibold text-amber-800 dark:text-amber-400">
              {view.rescoreError.message}
            </p>
            <p className="mt-0.5 text-xs text-amber-700 dark:text-amber-500">
              {view.rescoreError.action}
            </p>
          </div>
        ) : null}
        <FitScore
          fit={view.analysis.fit}
          freshness={fitFreshness}
          action={action}
          costLine={costLine}
          onRescore={
            onRescore
              ? () => onRescore(view.analysis?.fit?.profileFingerprint ?? null)
              : undefined
          }
          unavailable={unavailable}
          profileUnavailable={view.profileUnavailable}
          scoredBy={scoredByLabel(view.analysis)}
        />
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

interface RegionScopingProps {
  tabId: number;
  onCommit: (result: { text: string; selector: string }) => void;
  onCancel: () => void;
}

/**
 * FR-023/FR-024/FR-024a: both scoping mechanisms are reachable from this one
 * entry point. The keyboard list is the default surface — FR-024a forbids
 * gating the keyboard path behind the pointer one — with the pointer
 * overlay offered as an alternative rather than run at the same time: both
 * are live, page-side, promise-resolving sessions (`pickerService`'s
 * pointer pick holds exclusive page listeners until it resolves), and
 * running them together would leave whichever one the user didn't use
 * dangling with no way to tear it down from here. This toggle keeps exactly
 * one session live while keeping both reachable without leaving the entry
 * point.
 */
function RegionScoping({ tabId, onCommit, onCancel }: RegionScopingProps) {
  const [mode, setMode] = useState<"list" | "pointer">("list");

  if (mode === "pointer") {
    return (
      <PointerScoping
        tabId={tabId}
        onCommit={onCommit}
        onUseList={() => setMode("list")}
        onCancel={onCancel}
      />
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1">
        <RegionList tabId={tabId} onCommit={onCommit} onCancel={onCancel} />
      </div>
      <div className="shrink-0 border-t border-gray-200/70 px-3 py-2 text-center dark:border-gray-800">
        <button
          onClick={() => setMode("pointer")}
          className="text-xs font-medium text-blue-600 underline hover:text-blue-700 dark:text-blue-400"
        >
          Use the pointer on the page instead
        </button>
      </div>
    </div>
  );
}

/**
 * The pointer path (FR-024, FR-024c, FR-025): the page itself shows the
 * highlight and cursor-adjacent character count (pickerService.startPointerPick,
 * T100), so this surface is mostly a status line plus the two ways out. A
 * "no region found there" outcome is not a dismissal — it re-starts the same
 * pointer session so the user can just click again, rather than dropping
 * them out of pointer mode on a miss (T101 also lives in pickerService: the
 * page's own cleanup runs on every dismissal already).
 */
function PointerScoping({
  tabId,
  onCommit,
  onUseList,
  onCancel,
}: {
  tabId: number;
  onCommit: (result: { text: string; selector: string }) => void;
  onUseList: () => void;
  onCancel: () => void;
}) {
  const [notFound, setNotFound] = useState(false);
  const onCommitRef = useRef(onCommit);
  onCommitRef.current = onCommit;
  const onCancelRef = useRef(onCancel);
  onCancelRef.current = onCancel;

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      while (!cancelled) {
        const outcome = await pickerService.startPointerPick(tabId);
        if (cancelled) return;
        if (outcome.ok) {
          onCommitRef.current({ text: outcome.text, selector: outcome.selector });
          return;
        }
        if (outcome.reason === "dismissed") {
          onCancelRef.current();
          return;
        }
        setNotFound(true);
      }
    })();
    // The pointer session may still be pending when this unmounts (the
    // buttons below exit via cancelPointerPick too, but a parent-driven
    // unmount — e.g. switching tabs — would not otherwise reach the page at
    // all). Harmless if the session already resolved on its own.
    return () => {
      cancelled = true;
      void pickerService.cancelPointerPick(tabId);
    };
  }, [tabId]);

  // Exits FROM THE PANEL never send an Escape keydown to the page, so the
  // still-pending pointer promise needs an explicit external cancel or it
  // would never resolve — the page would be stuck in crosshair mode with
  // live listeners (see pickerService's cancelPointerPick).
  const exitToList = (): void => {
    void pickerService.cancelPointerPick(tabId);
    onUseList();
  };
  const exitToCancel = (): void => {
    void pickerService.cancelPointerPick(tabId);
    onCancel();
  };

  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
      <p className="text-sm font-medium text-gray-600 dark:text-gray-400">
        Point at a region on the page and click it.
      </p>
      <p className="text-xs text-gray-400 dark:text-gray-500">
        Press Escape on the page to cancel.
      </p>
      {notFound && (
        <p role="alert" className="text-xs font-semibold text-amber-700 dark:text-amber-400">
          No region was found there. Try clicking directly on the posting text.
        </p>
      )}
      <div className="flex gap-4">
        <button
          onClick={exitToList}
          className="text-xs font-medium text-blue-600 underline hover:text-blue-700 dark:text-blue-400"
        >
          Use the list instead
        </button>
        <button
          onClick={exitToCancel}
          className="text-xs font-medium text-gray-500 hover:text-gray-700 dark:text-gray-400"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
