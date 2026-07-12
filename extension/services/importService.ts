import type { JobStatus, SavedJob } from "../types/job";
import { JOB_STATUSES } from "../types/job";
import { jobStorage, LibraryFullError } from "./jobStorage";

/**
 * Import of a saved-jobs export file (the payload produced by
 * GET /jobs/export) into the signed-in account. Mirrors the migration
 * semantics: existing server entries always win and are counted as
 * duplicates, so importing the same file twice converges instead of
 * duplicating or clobbering newer notes/status.
 */

export const EXPORT_SCHEMA_VERSION = 1;

export type ImportStatus = "completed" | "cap-blocked" | "failed" | "invalid-file";

export interface ImportResult {
  status: ImportStatus;
  importedJobs: number;
  /** Jobs already present server-side (server copy wins, nothing overwritten). */
  skippedDuplicates: number;
  /** Entries in the file that are not well-formed saved-job records. */
  invalidEntries: number;
  errorMessage?: string;
}

function isExportedJob(value: unknown): value is SavedJob {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  const analysis = v.analysis as Record<string, unknown> | null;
  return (
    typeof v.schemaVersion === "number" &&
    typeof v.canonicalUrl === "string" &&
    v.canonicalUrl.length > 0 &&
    typeof v.sourceUrl === "string" &&
    typeof analysis === "object" &&
    analysis !== null &&
    typeof analysis.model === "string" &&
    typeof analysis.analyzedAt === "string" &&
    JOB_STATUSES.includes(v.status as JobStatus) &&
    typeof v.notes === "string" &&
    typeof v.savedAt === "string" &&
    typeof v.updatedAt === "string"
  );
}

function invalidFile(errorMessage: string): ImportResult {
  return {
    status: "invalid-file",
    importedJobs: 0,
    skippedDuplicates: 0,
    invalidEntries: 0,
    errorMessage,
  };
}

/**
 * Parses and uploads an export file on behalf of the signed-in user.
 * Idempotent per record; on cap or mid-file failure the counts report
 * exactly how far it got, and a retry with the same file converges.
 */
export async function importFromJson(json: string): Promise<ImportResult> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return invalidFile("This file is not valid JSON.");
  }

  const file = parsed as { schemaVersion?: unknown; jobs?: unknown };
  if (typeof parsed !== "object" || parsed === null || !Array.isArray(file.jobs)) {
    return invalidFile("This file is not a saved-jobs export.");
  }
  if (file.schemaVersion !== EXPORT_SCHEMA_VERSION) {
    return invalidFile("This export uses an unsupported schema version.");
  }

  const jobs = file.jobs.filter(isExportedJob);
  const invalidEntries = file.jobs.length - jobs.length;

  let importedJobs = 0;
  let skippedDuplicates = 0;
  try {
    for (const job of jobs) {
      const existing = await jobStorage.get(job.canonicalUrl);
      if (existing) {
        skippedDuplicates++;
        continue;
      }
      await jobStorage.save(job);
      importedJobs++;
    }
  } catch (err) {
    return {
      status: err instanceof LibraryFullError ? "cap-blocked" : "failed",
      importedJobs,
      skippedDuplicates,
      invalidEntries,
      errorMessage:
        err instanceof Error ? err.message : "The import could not finish.",
    };
  }

  return { status: "completed", importedJobs, skippedDuplicates, invalidEntries };
}
