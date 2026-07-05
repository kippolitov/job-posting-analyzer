export type Arrangement = "remote" | "hybrid" | "onsite" | "unspecified";

export type ArrangementConfidence = "explicit" | "inferred" | "none";

export type Seniority =
  | "junior"
  | "mid"
  | "senior"
  | "staff"
  | "principal"
  | "manager"
  | "director"
  | "executive"
  | "unspecified";

export type JobStatus =
  | "interested"
  | "applied"
  | "interviewing"
  | "rejected"
  | "ghosted"
  | "archived";

export const JOB_STATUSES: JobStatus[] = [
  "interested",
  "applied",
  "interviewing",
  "rejected",
  "ghosted",
  "archived",
];

export const ARRANGEMENTS: Arrangement[] = [
  "remote",
  "hybrid",
  "onsite",
  "unspecified",
];

export type SalaryPeriod = "year" | "month" | "day" | "hour";

export interface Salary {
  min: number | null;
  max: number | null;
  currency: string | null;
  period: SalaryPeriod | null;
}

export interface Fit {
  score: number;
  rationale: string;
}

/** Client-side extraction payload; never persisted. */
export interface PageExtract {
  url: string;
  canonicalUrl: string;
  title: string;
  jsonLd: Record<string, unknown>[];
  mainText: string;
  extractedAt: string;
}

/** Structured extraction result for one page at one point in time. */
export interface JobAnalysis {
  isJobPosting: boolean;
  title: string | null;
  company: string | null;
  location: string | null;
  arrangement: Arrangement;
  arrangementConfidence: ArrangementConfidence;
  arrangementEvidence: string | null;
  daysInOffice: number | null;
  daysRemote: number | null;
  remoteRestrictions: string | null;
  salary: Salary | null;
  seniority: Seniority;
  techStack: string[];
  fit: Fit | null;
  model: string;
  analyzedAt: string;
}

/** A persisted posting in the saved-jobs library. */
export interface SavedJob {
  schemaVersion: number;
  canonicalUrl: string;
  sourceUrl: string;
  analysis: JobAnalysis;
  status: JobStatus;
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
  | "unknown";

export interface JobPanelError {
  code: JobErrorCode;
  message: string;
  action: string;
  retryable: boolean;
}
