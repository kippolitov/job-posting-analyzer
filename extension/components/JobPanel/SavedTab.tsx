import { useCallback, useEffect, useState } from "react";
import { jobStorage } from "../../services/jobStorage";
import type { Arrangement, JobStatus, SavedJob } from "../../types/job";
import { ARRANGEMENTS, JOB_STATUSES } from "../../types/job";
import { SavedJobRow } from "./SavedJobRow";

type SortOrder = "newest" | "oldest";

type LoadState = "loading" | "ready" | "error";

export function SavedTab() {
  const [jobs, setJobs] = useState<SavedJob[]>([]);
  const [arrangement, setArrangement] = useState<Arrangement | "all">("all");
  const [status, setStatus] = useState<JobStatus | "all">("all");
  const [sortOrder, setSortOrder] = useState<SortOrder>("newest");
  // The library is server-backed: a failed load must show as a failure with
  // Retry, never as an empty library (FR-015).
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [actionError, setActionError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoadState((prev) => (prev === "ready" ? prev : "loading"));
    try {
      const filtered = await jobStorage.list({
        ...(arrangement !== "all" ? { arrangement } : {}),
        ...(status !== "all" ? { status } : {}),
      });
      setJobs(filtered);
      setLoadState("ready");
    } catch {
      setLoadState("error");
    }
  }, [arrangement, status]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const runAction = async (action: () => Promise<unknown>, failureMessage: string) => {
    try {
      await action();
      setActionError(null);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : failureMessage);
    }
  };

  const handleStatusChange = (canonicalUrl: string, newStatus: JobStatus) =>
    runAction(async () => {
      await jobStorage.update(canonicalUrl, { status: newStatus });
      await reload();
    }, "The status change could not be saved. Try again.");

  const handleNotesChange = (canonicalUrl: string, notes: string) =>
    runAction(async () => {
      await jobStorage.update(canonicalUrl, { notes });
      await reload();
    }, "The notes could not be saved. Try again.");

  const handleDelete = (canonicalUrl: string) =>
    runAction(async () => {
      await jobStorage.remove(canonicalUrl);
      await reload();
    }, "The posting could not be deleted. Try again.");

  const handleExport = () =>
    runAction(async () => {
      const json = await jobStorage.exportAll();
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `saved-jobs-${new Date().toISOString().slice(0, 10)}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
    }, "The export could not be downloaded. Try again.");

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

      {actionError && (
        <div
          role="alert"
          className="shrink-0 border-b border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300"
        >
          {actionError}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {loadState === "loading" && (
          <div
            role="status"
            className="flex items-center justify-center px-6 py-16 text-sm text-gray-400 dark:text-gray-500"
          >
            Loading saved postings…
          </div>
        )}

        {loadState === "error" && (
          <div
            role="alert"
            className="mx-auto mt-8 max-w-xs rounded-lg border border-red-200 bg-red-50 p-4 text-center dark:border-red-900/60 dark:bg-red-950/40"
          >
            <p className="text-sm font-medium text-red-700 dark:text-red-300">
              Your saved postings could not be loaded.
            </p>
            <p className="mt-1 text-xs text-red-600/80 dark:text-red-400/80">
              Check your connection — nothing has been lost.
            </p>
            <button
              onClick={() => void reload()}
              className="mt-3 rounded-md bg-red-600 px-3 py-1 text-xs font-semibold text-white hover:bg-red-700"
            >
              Retry
            </button>
          </div>
        )}

        {loadState === "ready" &&
          (displayed.length === 0 ? (
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
          ))}
      </div>
    </div>
  );
}
