import type { SavedJobPayload } from "@/api/types";
import { formatSalary } from "@/lib/formatJob";

export interface DayGroup {
  heading: string;
  /** Local calendar day, `YYYY-MM-DD`. */
  dateKey: string;
  jobs: SavedJobPayload[];
}

export interface JobSummary {
  salary: string;
  arrangement: string;
  location?: string;
  seniority?: string;
  sourceLabel: string;
  savedOn: string;
}

/** The browser's zone, unless a caller (a test) passes one. */
export const localTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

function dateKey(date: Date, timeZone: string): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/** Calendar-day arithmetic on a `YYYY-MM-DD` key, so DST never skews it. */
function dayDifference(fromKey: string, toKey: string): number {
  return Math.round((Date.parse(`${toKey}T00:00:00Z`) - Date.parse(`${fromKey}T00:00:00Z`)) / 86_400_000);
}

function heading(key: string, now: Date, timeZone: string): string {
  const days = dayDifference(key, dateKey(now, timeZone));
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  const sameYear = key.slice(0, 4) === dateKey(now, timeZone).slice(0, 4);
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "long",
    month: "long",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  }).format(new Date(`${key}T00:00:00Z`));
}

/**
 * FR-029: the library as a timeline. Groups by the calendar day of `savedAt`
 * in `timeZone`; newest day and entry first unless `direction` is "oldest".
 */
export function groupByDay(
  jobs: SavedJobPayload[],
  now: Date,
  timeZone: string,
  direction: "newest" | "oldest" = "newest"
): DayGroup[] {
  const sign = direction === "newest" ? -1 : 1;
  const byDay = new Map<string, SavedJobPayload[]>();
  for (const job of jobs) {
    const key = dateKey(new Date(job.savedAt), timeZone);
    byDay.set(key, [...(byDay.get(key) ?? []), job]);
  }
  return [...byDay.entries()]
    .sort(([a], [b]) => sign * a.localeCompare(b))
    .map(([key, group]) => ({
      heading: heading(key, now, timeZone),
      dateKey: key,
      jobs: group.sort((a, b) => sign * (Date.parse(a.savedAt) - Date.parse(b.savedAt))),
    }));
}

function arrangementText(analysis: SavedJobPayload["analysis"]): string {
  switch (analysis.arrangement) {
    case "remote":
      return "Remote";
    case "onsite":
      return "On-site";
    case "hybrid": {
      const days = analysis.daysInOffice;
      return days ? `Hybrid · ${days} ${days === 1 ? "day" : "days"} in office` : "Hybrid";
    }
    default:
      return "Arrangement not stated";
  }
}

function sourceLabel(job: SavedJobPayload): string {
  if (job.source === "document") return job.filename;
  if (job.source === "paste") return "Pasted";
  try {
    return new URL(job.sourceUrl).hostname;
  } catch {
    return job.sourceUrl;
  }
}

/** FR-030: the facts a library entry shows without opening the posting. */
export function summarizeJob(job: SavedJobPayload, timeZone: string): JobSummary {
  const { analysis } = job;
  return {
    salary: formatSalary(analysis) ?? "Salary not stated",
    arrangement: arrangementText(analysis),
    ...(analysis.location ? { location: analysis.location } : {}),
    ...(analysis.seniority && analysis.seniority !== "unspecified"
      ? { seniority: analysis.seniority }
      : {}),
    sourceLabel: sourceLabel(job),
    savedOn: new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "short",
      day: "numeric",
    }).format(new Date(job.savedAt)),
  };
}
