import type { CandidateProfile, SavedJob } from "../types/job";
import { jobStorage, LibraryFullError } from "./jobStorage";
import { getProfile, setProfile } from "./profileStorage";

/**
 * One-time migration of pre-002 device-local data into the account-backed
 * store (research.md R7, FR-010/FR-011). Legacy keys are read-only inputs:
 * they are deleted only after a fully completed migration, never on decline
 * or failure — losslessness is the invariant.
 */

export const MIGRATION_MARKER_KEY = "migration:v2";

const LEGACY_PROFILE_KEY = "profile";
const LEGACY_JOB_PREFIX = "job:";
const LEGACY_INDEX_KEY = "job:index";

export interface MigrationMarker {
  status: "completed" | "declined";
  at: string;
}

export interface LegacyData {
  profile: CandidateProfile | null;
  jobs: SavedJob[];
}

export type ProfileConflictChoice = "local" | "server";

export interface MigrationOptions {
  /**
   * Called when the account already has a server-side profile that differs
   * from the legacy local one — the user decides which to keep (FR-011).
   */
  resolveProfileConflict: (
    local: CandidateProfile,
    server: CandidateProfile
  ) => Promise<ProfileConflictChoice>;
}

export interface MigrationResult {
  status: "completed" | "cap-blocked" | "failed";
  uploadedJobs: number;
  /** Jobs already present server-side (server copy wins, nothing overwritten). */
  skippedDuplicates: number;
  profileOutcome: "uploaded" | "kept-server" | "none";
  errorMessage?: string;
}

function isLegacyJob(value: unknown): value is SavedJob {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as SavedJob).canonicalUrl === "string" &&
    typeof (value as SavedJob).analysis === "object"
  );
}

/** Legacy data present and the one-time offer not yet answered → data; else null. */
export async function detectLegacyData(): Promise<LegacyData | null> {
  const all = await chrome.storage.local.get(null);
  if (all[MIGRATION_MARKER_KEY]) return null;

  const rawProfile = all[LEGACY_PROFILE_KEY] as CandidateProfile | undefined;
  const profile =
    rawProfile && typeof rawProfile.text === "string" && rawProfile.text.length > 0
      ? rawProfile
      : null;

  const jobs = Object.entries(all)
    .filter(([key]) => key.startsWith(LEGACY_JOB_PREFIX) && key !== LEGACY_INDEX_KEY)
    .map(([, value]) => value)
    .filter(isLegacyJob);

  if (!profile && jobs.length === 0) return null;
  return { profile, jobs };
}

async function writeMarker(status: MigrationMarker["status"]): Promise<void> {
  const marker: MigrationMarker = { status, at: new Date().toISOString() };
  await chrome.storage.local.set({ [MIGRATION_MARKER_KEY]: marker });
}

async function deleteLegacyKeys(): Promise<void> {
  const all = await chrome.storage.local.get(null);
  const keys = Object.keys(all).filter(
    (key) => key === LEGACY_PROFILE_KEY || key.startsWith(LEGACY_JOB_PREFIX)
  );
  if (keys.length > 0) await chrome.storage.local.remove(keys);
}

async function migrateProfile(
  local: CandidateProfile,
  options: MigrationOptions
): Promise<"uploaded" | "kept-server"> {
  const server = await getProfile();
  const differs =
    server !== null &&
    (server.text !== local.text ||
      server.dealbreakers.join("\n") !== local.dealbreakers.join("\n"));
  if (differs) {
    const choice = await options.resolveProfileConflict(local, server);
    if (choice === "server") return "kept-server";
  }
  await setProfile({ text: local.text, dealbreakers: local.dealbreakers });
  return "uploaded";
}

/**
 * Accept path. Idempotent per record: existing server entries win and are
 * counted as duplicates, so a retry after partial failure converges. The
 * marker is written — and legacy keys deleted — only on full success.
 */
export async function runMigration(
  data: LegacyData,
  options: MigrationOptions
): Promise<MigrationResult> {
  let uploadedJobs = 0;
  let skippedDuplicates = 0;
  let profileOutcome: MigrationResult["profileOutcome"] = "none";

  try {
    if (data.profile) {
      profileOutcome = await migrateProfile(data.profile, options);
    }

    for (const job of data.jobs) {
      const existing = await jobStorage.get(job.canonicalUrl);
      if (existing) {
        skippedDuplicates++;
        continue;
      }
      await jobStorage.save(job);
      uploadedJobs++;
    }
  } catch (err) {
    if (err instanceof LibraryFullError) {
      return {
        status: "cap-blocked",
        uploadedJobs,
        skippedDuplicates,
        profileOutcome,
        errorMessage: err.message,
      };
    }
    return {
      status: "failed",
      uploadedJobs,
      skippedDuplicates,
      profileOutcome,
      errorMessage:
        err instanceof Error ? err.message : "The migration could not finish.",
    };
  }

  await writeMarker("completed");
  await deleteLegacyKeys();
  return { status: "completed", uploadedJobs, skippedDuplicates, profileOutcome };
}

/** Decline path: remember the answer, leave every legacy byte untouched. */
export async function declineMigration(): Promise<void> {
  await writeMarker("declined");
}
