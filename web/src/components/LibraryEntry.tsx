import { Link } from "react-router-dom";
import { FreshnessMarker } from "@/components/FreshnessMarker";
import { VerdictBadge } from "@/components/VerdictBadge";
import type { SavedJobPayload } from "@/api/types";
import { MAX_COMPARE_SELECTION } from "@/lib/compareStore";
import { summarizeJob } from "@/lib/libraryTimeline";

/** One library entry (FR-030): the key facts are visible without opening the posting. */
export function LibraryEntry({
  job,
  selected,
  selectionFull,
  onToggle,
  currentFingerprint,
  timeZone,
  showSavedDate,
}: {
  job: SavedJobPayload;
  selected: boolean;
  selectionFull: boolean;
  onToggle: () => void;
  currentFingerprint: string | null | undefined;
  timeZone: string;
  /** The fit sort drops the day headings, so each entry says when it was saved. */
  showSavedDate: boolean;
}) {
  const summary = summarizeJob(job, timeZone);
  const title = job.analysis.title ?? "Untitled posting";
  return (
    <li className="flex items-start gap-3 py-4">
      <input
        type="checkbox"
        aria-label={`Select ${job.analysis.title ?? "posting"} for comparison`}
        checked={selected}
        disabled={!selected && selectionFull}
        onChange={onToggle}
        className="mt-1.5"
      />
      <div className="grid min-w-0 flex-1 gap-x-6 gap-y-1 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <div className="min-w-0">
          <Link
            to={`/library/${encodeURIComponent(job.canonicalUrl)}`}
            className="font-medium hover:underline"
          >
            {title}
          </Link>
          {job.analysis.company && (
            <div className="text-sm text-gray-500 dark:text-gray-400">{job.analysis.company}</div>
          )}
          {job.analysis.fit && (
            <div className="mt-1">
              <VerdictBadge fit={job.analysis.fit} />
            </div>
          )}
          <FreshnessMarker job={job} currentFingerprint={currentFingerprint} />
        </div>
        <dl className="grid grid-cols-1 gap-x-4 gap-y-0.5 text-sm text-gray-600 dark:text-gray-300 min-[640px]:grid-cols-2">
          <dd>{summary.salary}</dd>
          <dd>{summary.arrangement}</dd>
          {summary.location && <dd>{summary.location}</dd>}
          {summary.seniority && <dd className="capitalize">{summary.seniority}</dd>}
          <dd className="text-xs uppercase text-gray-400">{job.status}</dd>
          <dd className="truncate text-xs text-gray-400 dark:text-gray-500">
            {job.source === "url" && job.sourceUrl ? (
              <a
                href={job.sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="text-blue-600 hover:underline dark:text-blue-400"
              >
                {summary.sourceLabel}
              </a>
            ) : (
              summary.sourceLabel
            )}
          </dd>
          {showSavedDate && <dd className="text-xs text-gray-400">Saved {summary.savedOn}</dd>}
        </dl>
      </div>
    </li>
  );
}

export const selectionIsFull = (count: number) => count >= MAX_COMPARE_SELECTION;
