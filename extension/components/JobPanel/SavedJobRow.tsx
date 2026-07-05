import { useState } from "react";
import type { JobStatus, SavedJob } from "../../types/job";
import { JOB_STATUSES } from "../../types/job";
import { ArrangementBadge } from "./ArrangementBadge";

interface SavedJobRowProps {
  job: SavedJob;
  onStatusChange: (canonicalUrl: string, status: JobStatus) => void;
  onNotesChange: (canonicalUrl: string, notes: string) => void;
  onDelete: (canonicalUrl: string) => void;
}

export function SavedJobRow({
  job,
  onStatusChange,
  onNotesChange,
  onDelete,
}: SavedJobRowProps) {
  const [notes, setNotes] = useState(job.notes);
  const title = job.analysis.title ?? "Untitled posting";

  return (
    <li className="rounded-xl border border-gray-200/70 bg-white p-3 dark:border-gray-800 dark:bg-gray-900">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <a
            href={job.sourceUrl}
            target="_blank"
            rel="noreferrer"
            className="block truncate text-sm font-semibold text-blue-700 hover:underline dark:text-blue-400"
            aria-label={`Open posting: ${title}`}
          >
            {title}
          </a>
          <p className="truncate text-xs text-gray-500 dark:text-gray-400">
            {[job.analysis.company, job.analysis.location].filter(Boolean).join(" — ")}
          </p>
        </div>
        <button
          onClick={() => onDelete(job.canonicalUrl)}
          aria-label={`Delete saved posting: ${title}`}
          title="Delete"
          className="shrink-0 rounded-md p-1.5 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
          </svg>
        </button>
      </div>

      <div className="mt-2 flex items-center gap-2">
        <ArrangementBadge
          arrangement={job.analysis.arrangement}
          daysInOffice={job.analysis.daysInOffice}
          daysRemote={job.analysis.daysRemote}
        />
        <label className="sr-only" htmlFor={`status-${job.canonicalUrl}`}>
          Status for {title}
        </label>
        <select
          id={`status-${job.canonicalUrl}`}
          value={job.status}
          onChange={(event) =>
            onStatusChange(job.canonicalUrl, event.target.value as JobStatus)
          }
          className="rounded-md border border-gray-200 bg-white px-1.5 py-0.5 text-xs text-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
        >
          {JOB_STATUSES.map((status) => (
            <option key={status} value={status}>
              {status}
            </option>
          ))}
        </select>
        <span className="ml-auto text-[10px] text-gray-400 dark:text-gray-500">
          saved {new Date(job.savedAt).toLocaleDateString()}
        </span>
      </div>

      <label className="sr-only" htmlFor={`notes-${job.canonicalUrl}`}>
        Notes for {title}
      </label>
      <textarea
        id={`notes-${job.canonicalUrl}`}
        value={notes}
        placeholder="Notes…"
        rows={notes ? 2 : 1}
        onChange={(event) => setNotes(event.target.value)}
        onBlur={() => {
          if (notes !== job.notes) onNotesChange(job.canonicalUrl, notes);
        }}
        className="mt-2 w-full resize-none rounded-md border border-gray-200 bg-gray-50 px-2 py-1 text-xs text-gray-700 placeholder:text-gray-400 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
      />
    </li>
  );
}
