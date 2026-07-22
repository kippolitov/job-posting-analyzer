import { Link } from "react-router-dom";
import { CompareGrid } from "@/components/CompareGrid";
import { useLibrary } from "@/lib/useLibrary";
import { useCompareSelection } from "@/lib/useCompareSelection";

export function Compare() {
  const state = useLibrary();
  const selection = useCompareSelection();

  if (state.status === "idle" || state.status === "loading") {
    return <div className="p-6 text-sm text-gray-500">Loading…</div>;
  }

  if (state.status === "error") {
    return (
      <div role="alert" className="p-6 text-red-600">
        {state.message}
      </div>
    );
  }

  const selectedJobs = state.jobs.filter((job) => selection.includes(job.canonicalUrl));

  return (
    <div className="flex flex-col gap-4">
      {selectedJobs.length === 0 && (
        <p className="text-sm text-gray-500">
          Pick postings to compare from the{" "}
          <Link to="/library" className="text-blue-600 hover:underline dark:text-blue-400">
            library
          </Link>
          .
        </p>
      )}
      <CompareGrid jobs={selectedJobs} />
    </div>
  );
}
