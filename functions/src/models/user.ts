import { isJobAnalysisPayload } from "./job";
import { isPreferences, type Preferences } from "../../../shared/types/profile";

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
/** Free rescores per month, the same on both tiers (006 research R6, FR-026). */
export const FREE_RESCORES_PER_MONTH = 10;
/** Refunded "posting unavailable" rescores per month (006 research R6, FR-003a). */
export const UNAVAILABLE_REFUNDS_PER_MONTH = 10;
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
  /** Free rescores used this month (006). Absent on older rows; reads as 0. */
  rescoresUsed?: number;
  /** "Posting unavailable" refunds granted this month (006). Absent reads as 0. */
  unavailableRefunds?: number;
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

/** `Profiles` row — PK sub, RK "profile" (data-model.md). */
export interface ProfileEntity {
  partitionKey: string;
  rowKey: "profile";
  text: string;
  /** JSON-encoded string[] */
  dealbreakers: string;
  updatedAt: string;
  schemaVersion: number;
  /** JSON-encoded string[]: the last 20 previous fingerprints, newest first (006 R5/R6). */
  fingerprintHistory?: string;
  /** JSON-encoded Preferences (006 PR4). Absent means none. */
  preferences?: string;
  /** JSON-encoded string[] (006 PR5). */
  confirmedSkills?: string;
}

/** Discriminates a saved posting's origin (data-model.md §2; "paste" added by 005 FR-020/FR-021). */
export type PostingSource = "url" | "document" | "paste";

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
  /** Absent on rows written before 004 — the repository defaults to "url" on read. */
  source?: string;
  /** Absent on rows written before 004 — the repository defaults to "" on read. */
  filename?: string;
  /** ISO timestamp of a rescore that found no posting (006 R7). Absent or "" when available. */
  unavailableAt?: string;
}

/** Wire shape of a saved job (matches the extension's `SavedJob`). */
export interface SavedJobPayload {
  schemaVersion: number;
  canonicalUrl: string;
  sourceUrl: string;
  /** Discriminator (data-model.md §2). Absent/"url" on legacy PUT bodies. */
  source: PostingSource;
  /** The uploaded document's original filename; "" for source="url". */
  filename: string;
  analysis: SavedJobAnalysis;
  status: JobStatus;
  notes: string;
  savedAt: string;
  updatedAt: string;
  /** Set after a rescore finds no posting; omitted when the posting is available (006). */
  unavailableAt?: string | null;
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

/**
 * PUT /api/profile body. Merge semantics (contracts/profile-api.md §2):
 * omitted optional fields keep their stored values; `preferences: null` and
 * `confirmedSkills: []` clear them.
 */
export interface ProfilePutBody {
  text: string;
  dealbreakers: string[];
  preferences?: Preferences | null;
  confirmedSkills?: string[];
}

/** Preferences are validated in full (PR4); skill validation lands with PR5. */
export function isProfilePutBody(body: unknown): body is ProfilePutBody {
  if (typeof body !== "object" || body === null) return false;
  const v = body as Record<string, unknown>;
  return (
    typeof v.text === "string" &&
    Array.isArray(v.dealbreakers) &&
    v.dealbreakers.every((d) => typeof d === "string") &&
    (v.preferences === undefined || v.preferences === null || isPreferences(v.preferences)) &&
    (v.confirmedSkills === undefined ||
      (Array.isArray(v.confirmedSkills) &&
        v.confirmedSkills.every((s) => typeof s === "string")))
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

const DOC_CANONICAL_URL_RE = /^doc:[0-9a-f]{64}$/;

/** 005 FR-021: a paste-sourced posting's stable, content-derived identity. */
export const PASTE_CANONICAL_URL_RE = /^paste:[0-9a-f]{64}$/;

/**
 * Discriminated on `source` (data-model.md §2.2): omitted/"url" validates
 * exactly as before (isHttpUrl canonicalUrl); "document" requires
 * canonicalUrl to match `doc:<sha256 hex>` and a non-empty filename, with
 * sourceUrl allowed to be empty. "paste" (005 FR-020/FR-021) mirrors
 * "document" structurally: canonicalUrl matches `paste:<sha256 hex>`, and
 * sourceUrl/filename are both empty — a pasted posting has neither a URL nor
 * a file.
 */
export function isSavedJobPutBody(body: unknown): body is SavedJobPayload {
  if (typeof body !== "object" || body === null) return false;
  const v = body as Record<string, unknown>;
  if (
    typeof v.schemaVersion !== "number" ||
    typeof v.sourceUrl !== "string" ||
    !isSavedJobAnalysis(v.analysis) ||
    !JOB_STATUSES.includes(v.status as JobStatus) ||
    typeof v.notes !== "string" ||
    v.notes.length > NOTES_MAX ||
    typeof v.savedAt !== "string" ||
    typeof v.updatedAt !== "string"
  ) {
    return false;
  }

  const source = v.source === undefined ? "url" : v.source;
  if (source === "document") {
    return (
      typeof v.canonicalUrl === "string" &&
      DOC_CANONICAL_URL_RE.test(v.canonicalUrl) &&
      typeof v.filename === "string" &&
      v.filename.length > 0
    );
  }
  if (source === "paste") {
    return (
      typeof v.canonicalUrl === "string" &&
      PASTE_CANONICAL_URL_RE.test(v.canonicalUrl) &&
      v.sourceUrl === "" &&
      (v.filename === undefined || v.filename === "")
    );
  }
  if (source === "url") {
    return isHttpUrl(v.canonicalUrl);
  }
  return false;
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
  /** ISO date, or null to clear. Ignored when `analysis` is also sent (006 contracts/saved-jobs-api.md). */
  unavailableAt?: string | null;
}

function isIsoDate(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T/.test(value) &&
    !Number.isNaN(Date.parse(value))
  );
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
  if (v.unavailableAt !== undefined && v.unavailableAt !== null && !isIsoDate(v.unavailableAt)) {
    return false;
  }
  return true;
}
