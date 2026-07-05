import { useCallback, useEffect, useState } from "react";
import { jobStorage } from "../../services/jobStorage";
import type { Arrangement, JobStatus, SavedJob } from "../../types/job";
import { ARRANGEMENTS, JOB_STATUSES } from "../../types/job";
import { SavedJobRow } from "./SavedJobRow";

type SortOrder = "newest" | "oldest";

export function SavedTab() {
  const [jobs, setJobs] = useState<SavedJob[]>([]);
  const [arrangement, setArrangement] = useState<Arrangement | "all">("all");
  const [status, setStatus] = useState<JobStatus | "all">("all");
  const [sortOrder, setSortOrder] = useState<SortOrder>("newest");
  const [loaded, setLoaded] = useState(false);

  const reload = useCallback(async () => {
    const filtered = await jobStorage.list({
      ...(arrangement !== "all" ? { arrangement } : {}),
      ...(status !== "all" ? { status } : {}),
    });
    setJobs(filtered);
    setLoaded(true);
  }, [arrangement, status]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const handleStatusChange = async (canonicalUrl: string, newStatus: JobStatus) => {
    await jobStorage.update(canonicalUrl, { status: newStatus });
    await reload();
  };

  const handleNotesChange = async (canonicalUrl: string, notes: string) => {
    await jobStorage.update(canonicalUrl, { notes });
    await reload();
  };

  const handleDelete = async (canonicalUrl: string) => {
    await jobStorage.remove(canonicalUrl);
    await reload();
  };

  const handleExport = async () => {
    const json = await jobStorage.exportAll();
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `saved-jobs-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const displayed =
    sortOrder === "newest"
      ? jobs
      : [...jobs].sort((a, b) => Date.parse(a.savedAt) - Date.parse(b.savedAt));

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-gray-200/70 bg-white px-3 py-2 dark:border-gray-800 dark:bg-gray-900">
        <label className="sr-only" htmlFor="filter-arrangement">
          Filter by arrangement
        </label>
        <select
          id="filter-arrangement"
          value={arrangement}
          onChange={(e) => setArrangement(e.target.value as Arrangement | "all")}
          className="rounded-md border border-gray-200 bg-white px-1.5 py-0.5 text-xs text-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
        >
          <option value="all">All arrangements</option>
          {ARRANGEMENTS.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>

        <label className="sr-only" htmlFor="filter-status">
          Filter by status
        </label>
        <select
          id="filter-status"
          value={status}
          onChange={(e) => setStatus(e.target.value as JobStatus | "all")}
          className="rounded-md border border-gray-200 bg-white px-1.5 py-0.5 text-xs text-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
        >
          <option value="all">All statuses</option>
          {JOB_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>

        <button
          onClick={() => setSortOrder(sortOrder === "newest" ? "oldest" : "newest")}
          aria-label={`Sorted by date saved, ${sortOrder} first. Click to reverse.`}
          className="rounded-md px-1.5 py-0.5 text-xs text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
        >
          {sortOrder === "newest" ? "Newest ↓" : "Oldest ↑"}
        </button>

        <button
          onClick={() => void handleExport()}
          className="ml-auto rounded-md px-2 py-0.5 text-xs font-medium text-blue-700 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-950/40"
        >
          Export
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {loaded && displayed.length === 0 ? (
          <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
            <p className="text-sm font-medium text-gray-600 dark:text-gray-400">
              No saved postings{arrangement !== "all" || status !== "all" ? " match these filters" : " yet"}
            </p>
            <p className="mt-1 text-xs text-gray-400 dark:text-gray-600">
              Analyzed postings you save will appear here.
            </p>
          </div>
        ) : (
          <ul aria-label="Saved postings" className="space-y-2">
            {displayed.map((job) => (
              <SavedJobRow
                key={job.canonicalUrl}
                job={job}
                onStatusChange={(url, s) => void handleStatusChange(url, s)}
                onNotesChange={(url, notes) => void handleNotesChange(url, notes)}
                onDelete={(url) => void handleDelete(url)}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
