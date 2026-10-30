export type {
  Arrangement,
  ArrangementConfidence,
  Seniority,
  SalaryPeriod,
  Salary,
  Fit,
  JobStatus,
  PageExtractPayload as PageExtract,
  JobAnalysisResponse as JobAnalysis,
  StructuredSource,
  StructuredSourceKind,
  ExtractionStrategy,
  ExtractionProvenance,
  ExtractArgs,
} from "../../shared/types/job";
export { JOB_STATUSES, ARRANGEMENTS } from "../../shared/types/job";

/** Discriminates a saved posting's origin. Absent/"url" for every save the extension made before this feature. */
export type PostingSource = "url" | "document" | "paste";

/** A persisted posting in the saved-jobs library. */
export interface SavedJob {
  schemaVersion: number;
  canonicalUrl: string;
  sourceUrl: string;
  /** Absent means "url" — every pre-005 saved job (FR-020). */
  source?: PostingSource;
  analysis: import("../../shared/types/job").JobAnalysisResponse;
  status: import("../../shared/types/job").JobStatus;
  notes: string;
  savedAt: string;
  updatedAt: string;
  /** Set after a rescore found no posting (006 contracts/saved-jobs-api.md). */
  unavailableAt?: string | null;
}

/** User-authored candidate profile, stored locally, sent only with analysis requests. */
export interface CandidateProfile {
  text: string;
  dealbreakers: string[];
  updatedAt: string;
  /** Server-derived (006 R5). Optional on read so an older backend still type-checks. */
  fingerprint?: string;
}

export type JobErrorCode =
  | "network-error"
  | "service-error"
  | "not-configured"
  | "extract-too-large"
  | "thin-content"
  | "no-access"
  | "usage-limit-reached"
  | "unknown";

/** contracts/metering.md 429 `usage` echo — carried on a usage-limit-reached error. */
export interface UsageInfo {
  count: number;
  limit: number;
  resetsAt: string;
  tier: "free" | "premium";
  /** 006: what this request cost, and the free-rescore allowance after it. */
  charged?: "none" | "rescore" | "analysis";
  rescoresUsed?: number;
  rescoresLimit?: number;
}

export interface JobPanelError {
  code: JobErrorCode;
  message: string;
  action: string;
  retryable: boolean;
  /** Present only for code "usage-limit-reached" (FR-009 exhausted state). */
  usage?: UsageInfo;
}
