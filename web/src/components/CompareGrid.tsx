import { Link } from "react-router-dom";
import { mergeRequirementRows, type RequirementCellState } from "shared/fitView";
import { FreshnessMarker } from "@/components/FreshnessMarker";
import { VerdictBadge } from "@/components/VerdictBadge";
import type { SavedJobPayload } from "@/api/types";
import { summarizeJob, localTimeZone } from "@/lib/libraryTimeline";

const CELL_TEXT: Record<RequirementCellState, string> = {
  matched: "✓ Matched",
  missing: "✗ Missing",
  "nice-to-have": "Nice to have",
  "not-asked": "—",
};

const CELL_CLASS: Record<RequirementCellState, string> = {
  matched: "text-green-700 dark:text-green-400",
  missing: "text-red-700 dark:text-red-400",
  "nice-to-have": "text-gray-600 dark:text-gray-300",
  "not-asked": "text-gray-400 dark:text-gray-600",
};

/** Requirement-by-posting table for the selected postings (FR-031). */
export function CompareGrid({
  jobs,
  currentFingerprint,
  onOpenPosting,
}: {
  jobs: SavedJobPayload[];
  currentFingerprint: string | null | undefined;
  /** Called when a column's link to the full analysis is followed. */
  onOpenPosting?: () => void;
}) {
  const timeZone = localTimeZone();
  const rows = mergeRequirementRows(jobs.map((job) => job.analysis.fit));

  return (
    <div className="overflow-x-auto" style={{ overflowX: "auto" }}>
      <table className="w-full border-collapse text-left text-sm">
        <thead>
          <tr className="align-top">
            <th scope="col" className="p-2">
              <span className="sr-only">Requirement</span>
            </th>
            {jobs.map((job) => {
              const summary = summarizeJob(job, timeZone);
              return (
                <th key={job.canonicalUrl} scope="col" className="min-w-40 p-2 font-normal">
                  <Link
                    to={`/library/${encodeURIComponent(job.canonicalUrl)}`}
                    onClick={onOpenPosting}
                    className="font-medium hover:underline"
                  >
                    {job.analysis.title ?? "Untitled posting"}
                  </Link>
                  {job.analysis.company && (
                    <div className="text-gray-500 dark:text-gray-400">{job.analysis.company}</div>
                  )}
                  {job.analysis.fit && (
                    <div className="mt-1">
                      <VerdictBadge fit={job.analysis.fit} />
                    </div>
                  )}
                  <FreshnessMarker job={job} currentFingerprint={currentFingerprint} />
                  <div className="mt-1 text-gray-600 dark:text-gray-300">{summary.salary}</div>
                  <div className="text-gray-600 dark:text-gray-300">{summary.arrangement}</div>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={jobs.length + 1} className="p-3 text-gray-500">
                No requirement breakdown to compare yet. Rescore these postings for one.
              </td>
            </tr>
          )}
          {rows.map((row) => (
            <tr key={row.label} className="border-t border-gray-200 dark:border-gray-800">
              <th scope="row" className="p-2 font-medium">
                {row.label}
              </th>
              {row.cells.map((cell, i) => (
                <td key={jobs[i].canonicalUrl} className={`p-2 ${CELL_CLASS[cell]}`}>
                  {cell === "not-asked" ? (
                    <span aria-label="Not asked">{CELL_TEXT[cell]}</span>
                  ) : (
                    CELL_TEXT[cell]
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
