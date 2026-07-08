import { isJobAnalysisPayload } from "./job";

/** Identity extracted from a verified Google ID token (auth contract). */
export interface AuthenticatedUser {
  sub: string;
  email: string;
}

export const PROFILE_TEXT_MAX = 4_000;
export const NOTES_MAX = 10_000;
export const SAVED_JOBS_SOFT_CAP = 1_000;

export const JOB_STATUSES = [
  "interested",
  "applied",
  "interviewing",
  "rejected",
  "ghosted",
  "archived",
] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const ARRANGEMENTS = ["remote", "hybrid", "onsite", "unspecified"] as const;
export type Arrangement = (typeof ARRANGEMENTS)[number];

/** `AllowedUsers` row — PK "AllowedUser", RK lowercased email (data-model.md). */
export interface AllowedUserEntity {
  partitionKey: "AllowedUser";
  rowKey: string;
  /** Populated by the middleware on the account's first successful sign-in. */
  sub?: string;
  addedAt: string;
  note?: string;
}

/** `Profiles` row — PK sub, RK "profile" (data-model.md). */
export interface ProfileEntity {
  partitionKey: string;
  rowKey: "profile";
  text: string;
  /** JSON-encoded string[] */
  dealbreakers: string;
  updatedAt: string;
  schemaVersion: number;
}

/** `SavedJobs` row — PK sub, RK sha256(canonicalUrl) (data-model.md). */
export interface SavedJobEntity {
  partitionKey: string;
  rowKey: string;
  canonicalUrl: string;
  sourceUrl: string;
  title: string;
  company: string;
  arrangement: string;
  status: string;
  notes: string;
  /** JSON-encoded JobAnalysis snapshot */
  analysisJson: string;
  savedAt: string;
  updatedAt: string;
  schemaVersion: number;
}

/** Wire shape of a saved job (matches the extension's `SavedJob`). */
export interface SavedJobPayload {
  schemaVersion: number;
  canonicalUrl: string;
  sourceUrl: string;
  analysis: SavedJobAnalysis;
  status: JobStatus;
  notes: string;
  savedAt: string;
  updatedAt: string;
}

/** The persisted analysis snapshot: model output plus server-appended fields. */
export interface SavedJobAnalysis extends Record<string, unknown> {
  isJobPosting: boolean;
  title: string | null;
  company: string | null;
  arrangement: Arrangement;
  model: string;
  analyzedAt: string;
}

export interface ProfilePutBody {
  text: string;
  dealbreakers: string[];
}

export function isProfilePutBody(body: unknown): body is ProfilePutBody {
  if (typeof body !== "object" || body === null) return false;
  const v = body as Record<string, unknown>;
  return (
    typeof v.text === "string" &&
    Array.isArray(v.dealbreakers) &&
    v.dealbreakers.every((d) => typeof d === "string")
  );
}

function isHttpUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0) return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function isSavedJobAnalysis(value: unknown): value is SavedJobAnalysis {
  if (!isJobAnalysisPayload(value)) return false;
  const v = value as unknown as Record<string, unknown>;
  return typeof v.model === "string" && typeof v.analyzedAt === "string";
}

export function isSavedJobPutBody(body: unknown): body is SavedJobPayload {
  if (typeof body !== "object" || body === null) return false;
  const v = body as Record<string, unknown>;
  return (
    typeof v.schemaVersion === "number" &&
    isHttpUrl(v.canonicalUrl) &&
    typeof v.sourceUrl === "string" &&
    isSavedJobAnalysis(v.analysis) &&
    JOB_STATUSES.includes(v.status as JobStatus) &&
    typeof v.notes === "string" &&
    v.notes.length <= NOTES_MAX &&
    typeof v.savedAt === "string" &&
    typeof v.updatedAt === "string"
  );
}

/**
 * PATCH body: any of status / notes / analysis. `canonicalUrl` and `savedAt`
 * may be echoed back but are immutable — the handler rejects changed values.
 */
export interface SavedJobPatchBody {
  status?: JobStatus;
  notes?: string;
  analysis?: SavedJobAnalysis;
  canonicalUrl?: string;
  savedAt?: string;
}

export function isSavedJobPatchBody(body: unknown): body is SavedJobPatchBody {
  if (typeof body !== "object" || body === null) return false;
  const v = body as Record<string, unknown>;
  if (v.status !== undefined && !JOB_STATUSES.includes(v.status as JobStatus)) {
    return false;
  }
  if (
    v.notes !== undefined &&
    (typeof v.notes !== "string" || v.notes.length > NOTES_MAX)
  ) {
    return false;
  }
  if (v.analysis !== undefined && !isSavedJobAnalysis(v.analysis)) return false;
  if (v.canonicalUrl !== undefined && typeof v.canonicalUrl !== "string") return false;
  if (v.savedAt !== undefined && typeof v.savedAt !== "string") return false;
  return true;
}
