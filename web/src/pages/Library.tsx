import { useRef, useState } from "react";
import { CompareDialog } from "@/components/CompareDialog";
import { CompareGrid } from "@/components/CompareGrid";
import { LibraryTimeline } from "@/components/LibraryTimeline";
import { useCurrentFingerprint } from "@/lib/useCurrentFingerprint";
import { LibraryControls } from "@/components/LibraryControls";
import { applyLibraryQuery, DEFAULT_LIBRARY_QUERY, type LibraryQuery } from "@/lib/libraryQuery";
import { useLibrary } from "@/lib/useLibrary";
import { useCompareSelection } from "@/lib/useCompareSelection";
import { MAX_COMPARE_SELECTION } from "@/lib/compareStore";

/** Signed-in library list (FR-007): fetches GET /api/jobs once, renders every posting. */
export function Library() {
  const state = useLibrary();
  const selection = useCompareSelection();
  const [query, setQuery] = useState<LibraryQuery>(DEFAULT_LIBRARY_QUERY);
  const currentFingerprint = useCurrentFingerprint();
  const [compareOpen, setCompareOpen] = useState(false);
  const compareButton = useRef<HTMLButtonElement>(null);
  const closeCompare = () => {
    setCompareOpen(false);
    compareButton.current?.focus();
  };

  if (state.status === "idle" || state.status === "loading") {
    return <div className="p-6 text-sm text-gray-500">Loading your library…</div>;
  }

  if (state.status === "error") {
    return (
      <div role="alert" className="p-6 text-red-600">
        {state.message}
      </div>
    );
  }

  if (state.jobs.length === 0) {
    return <div className="p-6 text-sm text-gray-500">No saved postings yet.</div>;
  }

  const visibleJobs = applyLibraryQuery(state.jobs, query, currentFingerprint);

  return (
    <div>
      <LibraryControls query={query} onChange={setQuery} />

      {selection.length > 0 && (
        <div className="mb-3 flex items-center gap-3 text-sm">
          <span>
            {selection.length} selected for comparison (max {MAX_COMPARE_SELECTION})
          </span>
        </div>
      )}
      <button
        ref={compareButton}
        type="button"
        disabled={selection.length < 2}
        onClick={() => setCompareOpen(true)}
        className="mb-3 rounded-md border border-gray-300 px-3 py-1 text-sm disabled:opacity-50 dark:border-gray-700"
      >
        Compare
      </button>

      {visibleJobs.length === 0 ? (
        <div className="p-6 text-sm text-gray-500">No postings match your filters.</div>
      ) : (
        <LibraryTimeline
          jobs={visibleJobs}
          sort={query.sort}
          selection={selection}
          currentFingerprint={currentFingerprint}
        />
      )}

      <CompareDialog open={compareOpen} onClose={closeCompare}>
        <CompareGrid
          jobs={state.jobs.filter((job) => selection.includes(job.canonicalUrl))}
          currentFingerprint={currentFingerprint}
          onOpenPosting={() => setCompareOpen(false)}
        />
      </CompareDialog>
    </div>
  );
}
