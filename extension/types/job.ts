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
} from "../../shared/types/job";
export { JOB_STATUSES, ARRANGEMENTS } from "../../shared/types/job";

/** A persisted posting in the saved-jobs library. */
export interface SavedJob {
  schemaVersion: number;
  canonicalUrl: string;
  sourceUrl: string;
  analysis: import("../../shared/types/job").JobAnalysisResponse;
  status: import("../../shared/types/job").JobStatus;
  notes: string;
  savedAt: string;
  updatedAt: string;
}

/** User-authored candidate profile, stored locally, sent only with analysis requests. */
export interface CandidateProfile {
  text: string;
  dealbreakers: string[];
  updatedAt: string;
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
}

export interface JobPanelError {
  code: JobErrorCode;
  message: string;
  action: string;
  retryable: boolean;
  /** Present only for code "usage-limit-reached" (FR-009 exhausted state). */
  usage?: UsageInfo;
}
