import { useEffect, useRef, useState } from "react";
import { MAIN_TEXT_CAP, MIN_TEXT_CHARS } from "../../lib/pageExtractor";
import { boundViolation } from "../../lib/textBounds";
import { fetchAccount } from "../../services/accountService";
import { UsageExhausted } from "../UsageExhausted";
import { AnalysisFields } from "./ThisPageTab";
import { FitScore } from "./FitScore";
import type { JobAnalysis, JobPanelError, SavedJob, UsageInfo } from "../../types/job";

export type PasteViewStatus = "idle" | "analyzing" | "ready" | "error";

export interface PasteView {
  status: PasteViewStatus;
  analysis: JobAnalysis | null;
  error: JobPanelError | null;
  canonicalUrl: string | null;
  saved: SavedJob | null;
}

interface PasteComposerProps {
  draft: string;
  onDraftChange: (text: string) => void;
  view: PasteView;
  onClose: () => void;
  onSubmit: () => void;
  onForceSubmit: () => void;
  onSave: () => void;
  onUpgrade: () => void;
}

/**
 * Opened by the header button (spec FR-017). Occupies the panel body while
 * open; the tab panels are hidden by the parent, which also disables the
 * tabs themselves (FR-017b) — this component only owns what happens inside
 * its own region.
 */
export function PasteComposer({
  draft,
  onDraftChange,
  view,
  onClose,
  onSubmit,
  onForceSubmit,
  onSave,
  onUpgrade,
}: PasteComposerProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [usage, setUsage] = useState<UsageInfo | null>(null);
  const [usageChecked, setUsageChecked] = useState(false);

  // FR-017b: focus moves into the composer on open. This component only
  // mounts while the composer is open, so a mount-time focus is exactly
  // "on open" — no imperative parent-driven focus call needed.
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  // FR-017f: check the allowance as soon as the composer opens, before the
  // user has typed anything — not defer discovering it to submission of a
  // draft they already spent time composing.
  useEffect(() => {
    let cancelled = false;
    void fetchAccount()
      .then((account) => {
        if (cancelled) return;
        setUsage({
          count: account.usage.count,
          limit: account.usage.limit,
          resetsAt: account.usage.resetsAt,
          tier: account.tier,
        });
      })
      .catch(() => {
        // Can't tell — let the normal submit-time check catch it instead of
        // blocking the composer on an account-fetch failure.
      })
      .finally(() => {
        if (!cancelled) setUsageChecked(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const allowanceExhausted =
    draft.length === 0 && usageChecked && usage !== null && usage.count >= usage.limit;

  // Document-level, not a per-element onKeyDown: once the analysis is ready
  // the textarea unmounts and focus may end up outside this subtree
  // entirely (e.g. back on the document body), and a bubbling handler on the
  // composer's own root would never see an Escape pressed from there.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    const handler = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onCloseRef.current();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  const violation = boundViolation(
    draft.length,
    MIN_TEXT_CHARS,
    MAIN_TEXT_CAP,
    "Paste more of the posting before analyzing.",
    "Trim it to the posting itself before analyzing."
  );

  return (
    <div
      role="region"
      aria-label="Paste a job posting"
      className="flex h-full flex-col"
    >
      <div className="flex items-center justify-between border-b border-gray-200/70 px-3 py-1.5 dark:border-gray-800">
        <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200">
          Paste a job posting
        </h2>
        <button
          onClick={onClose}
          aria-label="Close paste composer"
          className="rounded-md px-2 py-1 text-xs font-medium text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-800"
        >
          Close
        </button>
      </div>

      {allowanceExhausted && view.status !== "ready" ? (
        <div className="p-4">
          <UsageExhausted usage={usage as UsageInfo} onUpgrade={onUpgrade} />
        </div>
      ) : view.status === "analyzing" ? (
        <div
          role="status"
          aria-label="Analyzing pasted text, please wait"
          aria-live="polite"
          className="flex flex-1 flex-col items-center justify-center px-4"
        >
          <div
            className="h-10 w-10 animate-spin rounded-full border-[3px] border-gray-200 border-t-blue-600 dark:border-gray-700 dark:border-t-blue-500"
            aria-hidden="true"
          />
          <p className="mt-4 text-sm text-gray-500 dark:text-gray-400">Analyzing page…</p>
        </div>
      ) : view.status === "ready" && view.analysis ? (
        <div className="flex-1 space-y-4 overflow-y-auto p-4">
          {!view.analysis.isJobPosting ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-900/50 dark:bg-amber-950/30">
              <p className="text-sm font-semibold text-amber-800 dark:text-amber-400">
                This doesn&apos;t look like a job posting
              </p>
              <p className="mt-1 text-sm text-amber-700 dark:text-amber-500">
                You can analyze it anyway if this really is a job posting.
              </p>
              <button
                onClick={onForceSubmit}
                className="mt-3 rounded-md bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-700"
              >
                Analyze anyway
              </button>
            </div>
          ) : (
            <>
              {view.saved ? (
                <div className="rounded-xl border border-green-200 bg-green-50 p-3 dark:border-green-900/50 dark:bg-green-950/30">
                  <p className="text-xs font-semibold text-green-800 dark:text-green-300">
                    Saved to your library
                  </p>
                </div>
              ) : (
                <button
                  onClick={onSave}
                  className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-blue-700"
                >
                  Save
                </button>
              )}
              <FitScore fit={view.analysis.fit} />
              <AnalysisFields analysis={view.analysis} />
            </>
          )}
        </div>
      ) : (
        <>
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={(e) => onDraftChange(e.target.value)}
            placeholder="Paste a job posting…"
            aria-label="Pasted job posting text"
            className="min-h-40 flex-1 resize-none border-0 bg-transparent p-4 text-sm text-gray-800 outline-none placeholder:text-gray-400 dark:text-gray-100 dark:placeholder:text-gray-500"
          />
          <div className="flex items-center justify-between border-t border-gray-200/70 px-3 py-2 dark:border-gray-800">
            <span className="text-xs text-gray-400 dark:text-gray-500">
              {draft.length.toLocaleString()} characters
            </span>
            <button
              onClick={onSubmit}
              disabled={violation !== null || draft.length === 0}
              className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Analyze
            </button>
          </div>
          {violation && draft.length > 0 && (
            <div className="border-t border-amber-200 bg-amber-50 px-3 py-2 dark:border-amber-900/50 dark:bg-amber-950/30">
              <p className="text-xs font-semibold text-amber-800 dark:text-amber-400">
                {violation.message}
              </p>
              <p className="text-xs text-amber-700 dark:text-amber-500">{violation.action}</p>
            </div>
          )}
          {view.status === "error" && view.error && (
            <div
              role="alert"
              className="border-t border-red-200 bg-red-50 px-3 py-2 dark:border-red-900/50 dark:bg-red-950/30"
            >
              <p className="text-xs font-semibold text-red-800 dark:text-red-400">
                {view.error.message}
              </p>
              <p className="text-xs text-red-700 dark:text-red-500">{view.error.action}</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
