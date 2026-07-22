import { ARRANGEMENTS, JOB_STATUSES } from "shared/types/job";
import type { Arrangement, Seniority } from "shared/types/job";
import {
  activeFilterSummary,
  removeFilter,
  type LibraryQuery,
  type SortKey,
} from "@/lib/libraryQuery";

const SENIORITIES: Seniority[] = [
  "junior",
  "mid",
  "senior",
  "staff",
  "principal",
  "manager",
  "director",
  "executive",
  "unspecified",
];

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: "saved-desc", label: "Saved date (newest)" },
  { value: "saved-asc", label: "Saved date (oldest)" },
  { value: "fit-desc", label: "Fit score (highest)" },
  { value: "fit-asc", label: "Fit score (lowest)" },
];

/** Search + multi-criteria filter + sort controls (FR-010/FR-011/FR-012/FR-013). */
export function LibraryControls({
  query,
  onChange,
}: {
  query: LibraryQuery;
  onChange: (query: LibraryQuery) => void;
}) {
  const chips = activeFilterSummary(query);

  return (
    <div className="mb-4 flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col text-sm">
          <span className="mb-1 text-gray-600 dark:text-gray-300">Search</span>
          <input
            type="search"
            role="searchbox"
            aria-label="Search"
            value={query.text}
            onChange={(e) => onChange({ ...query, text: e.target.value })}
            placeholder="Title or company"
            className="rounded-md border border-gray-300 px-3 py-1.5 dark:border-gray-700 dark:bg-gray-900"
          />
        </label>

        <label className="flex flex-col text-sm">
          <span className="mb-1 text-gray-600 dark:text-gray-300">Status</span>
          <select
            aria-label="Status"
            value={query.status ?? ""}
            onChange={(e) =>
              onChange({ ...query, status: (e.target.value || undefined) as LibraryQuery["status"] })
            }
            className="rounded-md border border-gray-300 px-3 py-1.5 dark:border-gray-700 dark:bg-gray-900"
          >
            <option value="">Any</option>
            {JOB_STATUSES.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col text-sm">
          <span className="mb-1 text-gray-600 dark:text-gray-300">Arrangement</span>
          <select
            aria-label="Arrangement"
            value={query.arrangement ?? ""}
            onChange={(e) =>
              onChange({
                ...query,
                arrangement: (e.target.value || undefined) as Arrangement | undefined,
              })
            }
            className="rounded-md border border-gray-300 px-3 py-1.5 dark:border-gray-700 dark:bg-gray-900"
          >
            <option value="">Any</option>
            {ARRANGEMENTS.map((arrangement) => (
              <option key={arrangement} value={arrangement}>
                {arrangement}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col text-sm">
          <span className="mb-1 text-gray-600 dark:text-gray-300">Seniority</span>
          <select
            aria-label="Seniority"
            value={query.seniority ?? ""}
            onChange={(e) =>
              onChange({
                ...query,
                seniority: (e.target.value || undefined) as Seniority | undefined,
              })
            }
            className="rounded-md border border-gray-300 px-3 py-1.5 dark:border-gray-700 dark:bg-gray-900"
          >
            <option value="">Any</option>
            {SENIORITIES.map((seniority) => (
              <option key={seniority} value={seniority}>
                {seniority}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col text-sm">
          <span className="mb-1 text-gray-600 dark:text-gray-300">Min fit</span>
          <input
            type="number"
            aria-label="Minimum fit score"
            min={0}
            max={100}
            value={query.fitMin ?? ""}
            onChange={(e) =>
              onChange({
                ...query,
                fitMin: e.target.value === "" ? undefined : Number(e.target.value),
              })
            }
            className="w-20 rounded-md border border-gray-300 px-3 py-1.5 dark:border-gray-700 dark:bg-gray-900"
          />
        </label>

        <label className="flex flex-col text-sm">
          <span className="mb-1 text-gray-600 dark:text-gray-300">Max fit</span>
          <input
            type="number"
            aria-label="Maximum fit score"
            min={0}
            max={100}
            value={query.fitMax ?? ""}
            onChange={(e) =>
              onChange({
                ...query,
                fitMax: e.target.value === "" ? undefined : Number(e.target.value),
              })
            }
            className="w-20 rounded-md border border-gray-300 px-3 py-1.5 dark:border-gray-700 dark:bg-gray-900"
          />
        </label>

        <label className="flex flex-col text-sm">
          <span className="mb-1 text-gray-600 dark:text-gray-300">Sort</span>
          <select
            aria-label="Sort"
            value={query.sort}
            onChange={(e) => onChange({ ...query, sort: e.target.value as SortKey })}
            className="rounded-md border border-gray-300 px-3 py-1.5 dark:border-gray-700 dark:bg-gray-900"
          >
            {SORT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {chips.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {chips.map((chip) => (
            <button
              key={chip.key}
              type="button"
              onClick={() => onChange(removeFilter(query, chip.key))}
              className="flex items-center gap-1 rounded-full bg-blue-100 px-3 py-1 text-xs text-blue-800 hover:bg-blue-200 dark:bg-blue-950 dark:text-blue-200"
            >
              {chip.label} <span aria-hidden="true">×</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
