import type { SavedJobPayload } from "@/api/types";
import type { Arrangement, JobStatus, Seniority } from "shared/types/job";
import { filterByVerdict, freshness, sortByFit, verdictLabel, type Verdict } from "shared/fitView";

export type SortKey = "fit-desc" | "fit-asc" | "saved-desc" | "saved-asc";

/** Client-side search/filter/sort state (data-model.md §4, FR-010/FR-011/FR-012). */
export interface LibraryQuery {
  text: string;
  status?: JobStatus;
  arrangement?: Arrangement;
  seniority?: Seniority;
  /** Fit range 0–100. */
  fitMin?: number;
  fitMax?: number;
  /** Hide every posting not scored against the current profile (FR-008). */
  currentProfileOnly?: boolean;
  /** FR-028: only postings whose fit has this verdict; never matches an unrated fit. */
  verdict?: Exclude<Verdict, "unrated">;
  sort: SortKey;
}

export const DEFAULT_LIBRARY_QUERY: LibraryQuery = { text: "", sort: "saved-desc" };

function matchesText(job: SavedJobPayload, text: string): boolean {
  const needle = text.trim().toLowerCase();
  if (!needle) return true;
  const haystack = `${job.analysis.title ?? ""} ${job.analysis.company ?? ""}`.toLowerCase();
  return haystack.includes(needle);
}

function fitScore(job: SavedJobPayload): number | null {
  return job.analysis.fit?.score ?? null;
}

/** Pure search + filter + sort over the fetched library (no backend involvement). */
export function applyLibraryQuery(
  jobs: SavedJobPayload[],
  query: LibraryQuery,
  /** `undefined` = not known yet, `null` = no profile; only used by `currentProfileOnly`. */
  currentFingerprint?: string | null
): SavedJobPayload[] {
  const matching = jobs.filter((job) => {
    if (!matchesText(job, query.text)) return false;
    if (
      query.currentProfileOnly &&
      freshness(job.analysis.fit, currentFingerprint) !== "current"
    ) {
      return false;
    }
    if (query.status && job.status !== query.status) return false;
    if (query.arrangement && job.analysis.arrangement !== query.arrangement) return false;
    if (query.seniority && job.analysis.seniority !== query.seniority) return false;
    if (query.fitMin !== undefined || query.fitMax !== undefined) {
      const score = fitScore(job);
      if (score === null) return false;
      if (query.fitMin !== undefined && score < query.fitMin) return false;
      if (query.fitMax !== undefined && score > query.fitMax) return false;
    }
    return true;
  });
  const filtered = query.verdict ? filterByVerdict(matching, query.verdict) : matching;

  switch (query.sort) {
    case "fit-desc":
      return sortByFit(filtered, "highest");
    case "fit-asc":
      return sortByFit(filtered, "lowest");
    case "saved-asc":
      return [...filtered].sort((a, b) => Date.parse(a.savedAt) - Date.parse(b.savedAt));
    case "saved-desc":
    default:
      return [...filtered].sort((a, b) => Date.parse(b.savedAt) - Date.parse(a.savedAt));
  }
}

export interface FilterChip {
  key: "status" | "arrangement" | "seniority" | "fit" | "verdict" | "currentProfileOnly";
  label: string;
}

/** Visible, individually removable filter chips (FR-013). */
export function activeFilterSummary(query: LibraryQuery): FilterChip[] {
  const chips: FilterChip[] = [];
  if (query.status) chips.push({ key: "status", label: `Status: ${query.status}` });
  if (query.arrangement) {
    chips.push({ key: "arrangement", label: `Arrangement: ${query.arrangement}` });
  }
  if (query.seniority) chips.push({ key: "seniority", label: `Seniority: ${query.seniority}` });
  if (query.fitMin !== undefined || query.fitMax !== undefined) {
    chips.push({ key: "fit", label: `Fit: ${query.fitMin ?? 0}–${query.fitMax ?? 100}` });
  }
  if (query.verdict) {
    chips.push({ key: "verdict", label: `Verdict: ${verdictLabel(query.verdict)}` });
  }
  if (query.currentProfileOnly) {
    chips.push({ key: "currentProfileOnly", label: "Current profile only" });
  }
  return chips;
}

export function removeFilter(query: LibraryQuery, key: FilterChip["key"]): LibraryQuery {
  const next = { ...query };
  if (key === "fit") {
    delete next.fitMin;
    delete next.fitMax;
  } else {
    delete next[key];
  }
  return next;
}
