import { useMemo } from "react";
import { LibraryEntry, selectionIsFull } from "@/components/LibraryEntry";
import type { SavedJobPayload } from "@/api/types";
import type { SortKey } from "@/lib/libraryQuery";
import { groupByDay, localTimeZone } from "@/lib/libraryTimeline";
import { toggleCompareSelection } from "@/lib/compareStore";

/**
 * The library list (FR-029): under day headings for the date sorts, a flat
 * list with each save date for the fit sorts, where days would be misleading.
 */
export function LibraryTimeline({
  jobs,
  sort,
  selection,
  currentFingerprint,
}: {
  jobs: SavedJobPayload[];
  sort: SortKey;
  selection: string[];
  currentFingerprint: string | null | undefined;
}) {
  const timeZone = useMemo(localTimeZone, []);
  const full = selectionIsFull(selection.length);
  const entry = (job: SavedJobPayload, showSavedDate: boolean) => (
    <LibraryEntry
      key={job.canonicalUrl}
      job={job}
      selected={selection.includes(job.canonicalUrl)}
      selectionFull={full}
      onToggle={() => toggleCompareSelection(job.canonicalUrl)}
      currentFingerprint={currentFingerprint}
      timeZone={timeZone}
      showSavedDate={showSavedDate}
    />
  );

  if (sort === "fit-desc" || sort === "fit-asc") {
    return (
      <ul className="divide-y divide-gray-200 dark:divide-gray-800">
        {jobs.map((job) => entry(job, true))}
      </ul>
    );
  }

  const groups = groupByDay(
    jobs,
    new Date(),
    timeZone,
    sort === "saved-asc" ? "oldest" : "newest"
  );
  return (
    <div className="flex flex-col gap-6">
      {groups.map((group) => (
        <section key={group.dateKey}>
          <h3 className="mb-1 text-sm font-semibold text-gray-700 dark:text-gray-200">
            {group.heading}
          </h3>
          <ul className="divide-y divide-gray-200 dark:divide-gray-800">
            {group.jobs.map((job) => entry(job, false))}
          </ul>
        </section>
      ))}
    </div>
  );
}
