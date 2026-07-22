import { AnalysisView } from "@/components/AnalysisView";
import type { SavedJobPayload } from "@/api/types";
import { toggleCompareSelection } from "@/lib/compareStore";

/** Side-by-side comparison of the selected postings (FR-009, US2 scenario 4). */
export function CompareGrid({ jobs }: { jobs: SavedJobPayload[] }) {
  if (jobs.length === 0) {
    return (
      <div className="p-6 text-sm text-gray-500">
        Select postings from your library to compare them side by side.
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 xl:grid-cols-3">
      {jobs.map((job) => (
        <div
          key={job.canonicalUrl}
          className="rounded-md border border-gray-200 p-4 dark:border-gray-800"
        >
          <button
            type="button"
            onClick={() => toggleCompareSelection(job.canonicalUrl)}
            className="mb-2 text-xs text-gray-500 hover:underline"
          >
            Remove from comparison
          </button>
          <AnalysisView analysis={job.analysis} />
        </div>
      ))}
    </div>
  );
}
