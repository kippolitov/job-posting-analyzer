import { useState } from "react";
import { Link } from "react-router-dom";
import { LibraryControls } from "@/components/LibraryControls";
import { applyLibraryQuery, DEFAULT_LIBRARY_QUERY, type LibraryQuery } from "@/lib/libraryQuery";
import { useLibrary } from "@/lib/useLibrary";
import { useCompareSelection } from "@/lib/useCompareSelection";
import { MAX_COMPARE_SELECTION, toggleCompareSelection } from "@/lib/compareStore";

/** Signed-in library list (FR-007): fetches GET /api/jobs once, renders every posting. */
export function Library() {
  const state = useLibrary();
  const selection = useCompareSelection();
  const [query, setQuery] = useState<LibraryQuery>(DEFAULT_LIBRARY_QUERY);

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

  const visibleJobs = applyLibraryQuery(state.jobs, query);

  return (
    <div>
      <LibraryControls query={query} onChange={setQuery} />

      {selection.length > 0 && (
        <div className="mb-3 flex items-center gap-3 text-sm">
          <span>
            {selection.length} selected for comparison (max {MAX_COMPARE_SELECTION})
          </span>
          <Link to="/compare" className="text-blue-600 hover:underline dark:text-blue-400">
            Compare
          </Link>
        </div>
      )}

      {visibleJobs.length === 0 ? (
        <div className="p-6 text-sm text-gray-500">No postings match your filters.</div>
      ) : (
        <ul className="divide-y divide-gray-200 dark:divide-gray-800">
          {visibleJobs.map((job) => (
            <li key={job.canonicalUrl} className="flex items-start gap-3 py-4">
              <input
                type="checkbox"
                aria-label={`Select ${job.analysis.title ?? "posting"} for comparison`}
                checked={selection.includes(job.canonicalUrl)}
                disabled={
                  !selection.includes(job.canonicalUrl) && selection.length >= MAX_COMPARE_SELECTION
                }
                onChange={() => toggleCompareSelection(job.canonicalUrl)}
                className="mt-1.5"
              />
              <div>
                <Link
                  to={`/library/${encodeURIComponent(job.canonicalUrl)}`}
                  className="font-medium hover:underline"
                >
                  {job.analysis.title ?? "Untitled posting"}
                </Link>
                {job.analysis.company && (
                  <div className="text-sm text-gray-500 dark:text-gray-400">
                    {job.analysis.company}
                  </div>
                )}
                {job.source === "document" ? (
                  <div className="text-xs text-gray-400 dark:text-gray-500">{job.filename}</div>
                ) : (
                  job.sourceUrl && (
                    <a
                      href={job.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs text-blue-600 hover:underline dark:text-blue-400"
                    >
                      {job.sourceUrl}
                    </a>
                  )
                )}
                <div className="mt-1 text-xs uppercase text-gray-400">{job.status}</div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
