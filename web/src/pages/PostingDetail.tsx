import { Link, useParams } from "react-router-dom";
import { AnalysisView } from "@/components/AnalysisView";
import { useLibrary } from "@/lib/useLibrary";

/** Full stored analysis for one posting (FR-008, spec US1 scenario 2). */
export function PostingDetail() {
  const { key } = useParams<{ key: string }>();
  const state = useLibrary();

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

  const canonicalUrl = key ? decodeURIComponent(key) : "";
  const job = state.jobs.find((j) => j.canonicalUrl === canonicalUrl);

  if (!job) {
    return (
      <div className="p-6 text-sm text-gray-500">
        That posting isn&rsquo;t in your library.{" "}
        <Link to="/library" className="text-blue-600 hover:underline dark:text-blue-400">
          Back to library
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <Link to="/library" className="text-sm text-blue-600 hover:underline dark:text-blue-400">
        ← Back to library
      </Link>
      <AnalysisView analysis={job.analysis} />
      {job.notes && (
        <div>
          <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-200">Notes</h4>
          <p className="whitespace-pre-wrap text-sm text-gray-600 dark:text-gray-300">
            {job.notes}
          </p>
        </div>
      )}
    </div>
  );
}
