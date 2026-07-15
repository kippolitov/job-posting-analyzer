import { isJobAnalysisPayload } from "./job";

/** Freemium entitlement tier (data-model.md `Users.tier`). */
export const TIERS = ["free", "premium"] as const;
export type Tier = (typeof TIERS)[number];

export function isTier(value: unknown): value is Tier {
  return typeof value === "string" && (TIERS as readonly string[]).includes(value);
}

/** Identity extracted from a verified Google ID token (auth contract). */
export interface AuthenticatedUser {
  sub: string;
  email: string;
  /** Entitlement tier, attached by withAuth from the Users row. */
  tier: Tier;
}

// Sized for a full pasted resume; must match the extension's PROFILE_TEXT_MAX.
export const PROFILE_TEXT_MAX = 20_000;
export const NOTES_MAX = 10_000;
export const SAVED_JOBS_SOFT_CAP = 1_000;

/** The only place per-tier limits live (data-model.md "Per-tier entitlements"). */
export const MONTHLY_ANALYSES: Record<Tier, number> = { free: 50, premium: 300 };
export const SAVED_JOBS_CAP: Record<Tier, number> = {
  free: 100,
  premium: SAVED_JOBS_SOFT_CAP,
};

/** `Users` row — PK "User", RK lowercased email (data-model.md). */
export interface UserEntity {
  partitionKey: "User";
  rowKey: string;
  /** Google stable id; absent for migrated rows that have never signed in. */
  sub?: string;
  tier: Tier;
  /** Admin override (CLI): true ⇒ 403 in withAuth. */
  blocked?: boolean;
  createdAt: string;
  migratedFromAllowlist?: boolean;
  paddleCustomerId?: string;
  paddleSubscriptionId?: string;
  subscriptionStatus?: "active" | "past_due" | "paused" | "canceled";
  renewsAt?: string;
  endsAt?: string;
  /** Stale guard: events with an older occurred_at are ignored (R4). */
  paddleEventOccurredAt?: string;
}

export function isUserEntity(value: unknown): value is UserEntity {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    v.partitionKey === "User" &&
    typeof v.rowKey === "string" &&
    isTier(v.tier) &&
    typeof v.createdAt === "string"
  );
}

/** `Usage` row — PK sub, RK "usage-" + YYYY-MM (data-model.md). */
export interface UsageEntity {
  partitionKey: string;
  rowKey: string;
  count: number;
  limit: number;
}

export function isUsageEntity(value: unknown): value is UsageEntity {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.partitionKey === "string" &&
    typeof v.rowKey === "string" &&
    typeof v.count === "number" &&
    typeof v.limit === "number"
  );
}

/** `PaddleEvents` row — PK "PaddleEvent", RK event id (data-model.md). */
export interface PaddleEventEntity {
  partitionKey: "PaddleEvent";
  rowKey: string;
  eventType: string;
  occurredAt: string;
  processedAt: string;
  sub?: string;
}

export function isPaddleEventEntity(value: unknown): value is PaddleEventEntity {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    v.partitionKey === "PaddleEvent" &&
    typeof v.rowKey === "string" &&
    typeof v.eventType === "string" &&
    typeof v.occurredAt === "string" &&
    typeof v.processedAt === "string"
  );
}

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
